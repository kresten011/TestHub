
/*
 * TESTHUB C BACKEND
 * Windows + GCC + XAMPP MariaDB
 *
 * API:
 *   POST /api/register.php
 *   POST /api/login.php
 *   POST /api/logout.php
 *   GET  /api/profile.php
 *   POST /api/profile.php
 *   GET  /api/exams.php
 *   POST /api/exams.php
 *   GET  /api/exams.php?id=ID
 *   POST /api/submissions.php
 *   GET  /api/submissions.php
 *   POST /api/submissions.php   action=release / score_essay
 *   GET  /api/results.php
 *
 * Expected DB:
 *   testhub database from the SQL supplied with this project.
 *
 * This is a school/local prototype. For production, use a stronger
 * password KDF such as Argon2id/bcrypt, HTTPS, stricter CORS, and
 * a more complete HTTP/JSON library.
 */

#define _CRT_SECURE_NO_WARNINGS

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <time.h>

#include <winsock2.h>
#include <windows.h>
#include <bcrypt.h>

#include <mysql.h>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "bcrypt.lib")

#define PORT 8080
#define BUFFER_SIZE 262144
#define SMALL 256
#define MEDIUM 4096
#define LARGE 65536

#define DB_HOST "127.0.0.1"
#define DB_USER "root"
#define DB_PASS ""
#define DB_NAME "testhub"
#define DB_PORT 3306

static MYSQL *db = NULL;

/* =========================================================
   Utility
   ========================================================= */

static void trim(char *s)
{
    size_t n;
    if (!s) return;
    while (*s && isspace((unsigned char)*s)) memmove(s, s + 1, strlen(s));
    n = strlen(s);
    while (n && isspace((unsigned char)s[n - 1])) s[--n] = '\0';
}

static void url_decode(char *dst, const char *src, size_t cap)
{
    size_t di = 0;
    for (size_t i = 0; src && src[i] && di + 1 < cap; i++) {
        if (src[i] == '%' && isxdigit((unsigned char)src[i+1]) && isxdigit((unsigned char)src[i+2])) {
            char hex[3] = { src[i+1], src[i+2], 0 };
            dst[di++] = (char)strtol(hex, NULL, 16);
            i += 2;
        } else if (src[i] == '+') {
            dst[di++] = ' ';
        } else {
            dst[di++] = src[i];
        }
    }
    dst[di] = '\0';
}

static int json_find_key(const char *json, const char *key, const char **value)
{
    char needle[256];
    snprintf(needle, sizeof(needle), "\"%s\"", key);
    const char *p = json;
    while ((p = strstr(p, needle)) != NULL) {
        p += strlen(needle);
        while (*p && isspace((unsigned char)*p)) p++;
        if (*p == ':') {
            p++;
            while (*p && isspace((unsigned char)*p)) p++;
            *value = p;
            return 1;
        }
    }
    return 0;
}

static int json_get_string(const char *json, const char *key, char *out, size_t cap)
{
    const char *p;
    size_t n = 0;
    if (!json_find_key(json, key, &p) || *p != '"') return 0;
    p++;
    while (*p && *p != '"' && n + 1 < cap) {
        if (*p == '\\' && p[1]) {
            p++;
            switch (*p) {
                case 'n': out[n++] = '\n'; break;
                case 'r': out[n++] = '\r'; break;
                case 't': out[n++] = '\t'; break;
                case '"': out[n++] = '"'; break;
                case '\\': out[n++] = '\\'; break;
                default: out[n++] = *p; break;
            }
            p++;
        } else {
            out[n++] = *p++;
        }
    }
    out[n] = '\0';
    return 1;
}

static int json_get_int(const char *json, const char *key, int *out)
{
    const char *p;
    if (!json_find_key(json, key, &p)) return 0;
    *out = atoi(p);
    return 1;
}

static int json_get_double(const char *json, const char *key, double *out)
{
    const char *p;
    if (!json_find_key(json, key, &p)) return 0;
    *out = atof(p);
    return 1;
}

static int json_get_raw(const char *json, const char *key, char *out, size_t cap)
{
    const char *p;
    size_t n = 0;
    if (!json_find_key(json, key, &p)) return 0;

    if (*p == '"') {
        return json_get_string(json, key, out, cap);
    }

    if (*p != '[' && *p != '{') return 0;

    char open = *p;
    char close = (open == '[') ? ']' : '}';
    int depth = 0;
    int in_string = 0;
    int escape = 0;

    while (*p && n + 1 < cap) {
        char c = *p;
        out[n++] = c;

        if (in_string) {
            if (escape) escape = 0;
            else if (c == '\\') escape = 1;
            else if (c == '"') in_string = 0;
        } else {
            if (c == '"') in_string = 1;
            else if (c == open) depth++;
            else if (c == close) {
                depth--;
                if (depth == 0) {
                    n++;
                    break;
                }
            }
        }
        p++;
    }
    out[n] = '\0';
    return depth == 0;
}

static void json_escape(const char *src, char *dst, size_t cap)
{
    size_t n = 0;
    for (size_t i = 0; src && src[i] && n + 2 < cap; i++) {
        unsigned char c = (unsigned char)src[i];
        if (c == '"' || c == '\\') {
            dst[n++] = '\\';
            dst[n++] = (char)c;
        } else if (c == '\n') {
            dst[n++] = '\\'; dst[n++] = 'n';
        } else if (c == '\r') {
            dst[n++] = '\\'; dst[n++] = 'r';
        } else if (c == '\t') {
            dst[n++] = '\\'; dst[n++] = 't';
        } else if (c < 32) {
            dst[n++] = ' ';
        } else {
            dst[n++] = (char)c;
        }
    }
    dst[n] = '\0';
}

static int extract_object(const char *array, size_t *pos, char *object, size_t cap)
{
    size_t i = *pos;
    int depth = 0, in_string = 0, escape = 0;
    while (array[i] && array[i] != '{') i++;
    if (!array[i]) return 0;

    size_t start = i;
    for (; array[i]; i++) {
        char c = array[i];
        if (in_string) {
            if (escape) escape = 0;
            else if (c == '\\') escape = 1;
            else if (c == '"') in_string = 0;
        } else {
            if (c == '"') in_string = 1;
            else if (c == '{') depth++;
            else if (c == '}') {
                depth--;
                if (depth == 0) {
                    size_t len = i - start + 1;
                    if (len >= cap) len = cap - 1;
                    memcpy(object, array + start, len);
                    object[len] = '\0';
                    *pos = i + 1;
                    return 1;
                }
            }
        }
    }
    return 0;
}

static void sql_escape(const char *src, char *dst, size_t cap)
{
    mysql_real_escape_string(db, dst, src ? src : "", src ? strlen(src) : 0);
    dst[cap - 1] = '\0';
}

/* =========================================================
   Password hashing using Windows CNG SHA-256
   ========================================================= */

static int sha256_hex(const char *input, char *hex, size_t hex_cap)
{
    BCRYPT_ALG_HANDLE alg = NULL;
    BCRYPT_HASH_HANDLE hash = NULL;
    DWORD hash_len = 0, result = 0;
    PUCHAR digest = NULL;
    int ok = 0;

    if (hex_cap < 65) return 0;

    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, NULL, 0) != 0)
        goto cleanup;

    if (BCryptGetProperty(alg, BCRYPT_HASH_LENGTH,
                          (PUCHAR)&hash_len, sizeof(hash_len),
                          &result, 0) != 0)
        goto cleanup;

    digest = (PUCHAR)malloc(hash_len);
    if (!digest) goto cleanup;

    if (BCryptCreateHash(alg, &hash, NULL, 0, NULL, 0, 0) != 0)
        goto cleanup;

    if (BCryptHashData(hash, (PUCHAR)input, (ULONG)strlen(input), 0) != 0)
        goto cleanup;

    if (BCryptFinishHash(hash, digest, hash_len, 0) != 0)
        goto cleanup;

    for (DWORD i = 0; i < hash_len; i++)
        sprintf(hex + (i * 2), "%02x", digest[i]);

    hex[64] = '\0';
    ok = 1;

cleanup:
    if (hash) BCryptDestroyHash(hash);
    if (alg) BCryptCloseAlgorithmProvider(alg, 0);
    free(digest);
    return ok;
}

static int make_token(char *token, size_t cap)
{
    unsigned char bytes[32];

    if (cap < 65) return 0;

    if (BCryptGenRandom(NULL, bytes, sizeof(bytes),
                        BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0)
        return 0;

    for (int i = 0; i < 32; i++)
        sprintf(token + i * 2, "%02x", bytes[i]);

    token[64] = '\0';
    return 1;
}

/* =========================================================
   Database
   ========================================================= */

static int db_connect(void)
{
    db = mysql_init(NULL);
    if (!db) {
        printf("mysql_init failed\n");
        return 0;
    }

    mysql_options(db, MYSQL_SET_CHARSET_NAME, "utf8mb4");

    if (!mysql_real_connect(
        db,
        DB_HOST,
        DB_USER,
        DB_PASS,
        DB_NAME,
        DB_PORT,
        NULL,
        0))
    {
        printf("MariaDB connection failed: %s\n", mysql_error(db));
        mysql_close(db);
        db = NULL;
        return 0;
    }

    printf("Connected to XAMPP MariaDB database: %s\n", DB_NAME);
    return 1;
}

static int db_exec(const char *sql)
{
    if (mysql_query(db, sql) != 0) {
        printf("SQL error: %s\n", mysql_error(db));
        return 0;
    }
    return 1;
}

static int db_setup(void)
{
    const char *sql[] = {
        "CREATE TABLE IF NOT EXISTS users ("
        "id INT AUTO_INCREMENT PRIMARY KEY,"
        "username VARCHAR(100) NOT NULL UNIQUE,"
        "password VARCHAR(255) NOT NULL,"
        "role ENUM('student','teacher') NOT NULL DEFAULT 'student',"
        "name VARCHAR(150) NOT NULL,"
        "age VARCHAR(20) DEFAULT '',"
        "section VARCHAR(100) DEFAULT 'N/A',"
        "school VARCHAR(150) DEFAULT 'N/A',"
        "picture LONGTEXT NULL,"
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ")",

        "CREATE TABLE IF NOT EXISTS exams ("
        "id INT AUTO_INCREMENT PRIMARY KEY,"
        "exam_code VARCHAR(50) NOT NULL UNIQUE,"
        "title VARCHAR(255) NOT NULL,"
        "description TEXT,"
        "teacher_id INT NOT NULL,"
        "deadline DATETIME NOT NULL,"
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
        "FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE"
        ")",

        "CREATE TABLE IF NOT EXISTS questions ("
        "id INT AUTO_INCREMENT PRIMARY KEY,"
        "exam_id INT NOT NULL,"
        "question_number INT NOT NULL,"
        "question_text TEXT NOT NULL,"
        "question_type ENUM('mcq','tf','essay') NOT NULL,"
        "choice_a TEXT NULL, choice_b TEXT NULL, choice_c TEXT NULL, choice_d TEXT NULL,"
        "correct_answer TEXT NULL,"
        "points INT DEFAULT 1,"
        "FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE"
        ")",

        "CREATE TABLE IF NOT EXISTS submissions ("
        "id INT AUTO_INCREMENT PRIMARY KEY,"
        "exam_id INT NOT NULL,"
        "student_id INT NOT NULL,"
        "status ENUM('submitted','released','pending') DEFAULT 'submitted',"
        "score DECIMAL(10,2) DEFAULT 0,"
        "submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
        "released_at TIMESTAMP NULL DEFAULT NULL,"
        "UNIQUE KEY unique_exam_student(exam_id,student_id),"
        "FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,"
        "FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE"
        ")",

        "CREATE TABLE IF NOT EXISTS answers ("
        "id INT AUTO_INCREMENT PRIMARY KEY,"
        "submission_id INT NOT NULL,"
        "question_id INT NOT NULL,"
        "answer TEXT NULL,"
        "essay_score DECIMAL(10,2) NULL,"
        "FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,"
        "FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE"
        ")",

        "CREATE TABLE IF NOT EXISTS sessions ("
        "id INT AUTO_INCREMENT PRIMARY KEY,"
        "user_id INT NOT NULL,"
        "token VARCHAR(255) NOT NULL UNIQUE,"
        "expires_at DATETIME NOT NULL,"
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
        "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
        ")"
    };

    for (size_t i = 0; i < sizeof(sql)/sizeof(sql[0]); i++)
        if (!db_exec(sql[i])) return 0;

    return 1;
}

/* =========================================================
   HTTP helpers
   ========================================================= */

typedef struct {
    char method[16];
    char path[512];
    char query[4096];
    char *body;
    size_t body_len;
} Request;

static int parse_request(char *raw, Request *req)
{
    char *line_end = strstr(raw, "\r\n");
    if (!line_end) return 0;

    *line_end = '\0';

    char target[4096];
    if (sscanf(raw, "%15s %4095s", req->method, target) != 2)
        return 0;

    char *q = strchr(target, '?');
    if (q) {
        *q = '\0';
        strncpy(req->path, target, sizeof(req->path)-1);
        strncpy(req->query, q + 1, sizeof(req->query)-1);
    } else {
        strncpy(req->path, target, sizeof(req->path)-1);
        req->query[0] = '\0';
    }

    req->body = strstr(line_end + 2, "\r\n\r\n");
    if (!req->body) {
        req->body = raw + strlen(raw);
        req->body_len = 0;
        return 1;
    }

    req->body += 4;
    req->body_len = strlen(req->body);
    return 1;
}

static void send_response(SOCKET client, int status, const char *body)
{
    const char *status_text = "OK";
    if (status == 201) status_text = "Created";
    else if (status == 400) status_text = "Bad Request";
    else if (status == 401) status_text = "Unauthorized";
    else if (status == 403) status_text = "Forbidden";
    else if (status == 404) status_text = "Not Found";
    else if (status == 409) status_text = "Conflict";
    else if (status == 500) status_text = "Internal Server Error";

    char header[1024];
    size_t len = strlen(body);

    int n = snprintf(header, sizeof(header),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Headers: Content-Type, Authorization\r\n"
        "Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n"
        "Content-Length: %zu\r\n"
        "Connection: close\r\n\r\n",
        status, status_text, len);

    send(client, header, n, 0);
    send(client, body, (int)len, 0);
}

static void send_text(SOCKET client, int status, const char *json)
{
    send_response(client, status, json);
}

static int get_query_value(const char *query, const char *key,
                           char *out, size_t cap)
{
    if (!query || !*query) return 0;

    char copy[4096];
    strncpy(copy, query, sizeof(copy)-1);
    copy[sizeof(copy)-1] = '\0';

    char *save = NULL;
    char *part = strtok_s(copy, "&", &save);

    while (part) {
        char *eq = strchr(part, '=');
        if (eq) {
            *eq = '\0';
            if (_stricmp(part, key) == 0) {
                url_decode(out, eq + 1, cap);
                return 1;
            }
        }
        part = strtok_s(NULL, "&", &save);
    }

    return 0;
}

static int get_authorization_token(const char *raw, char *token, size_t cap)
{
    const char *p = strstr(raw, "\r\nAuthorization:");
    if (!p) p = strstr(raw, "\nauthorization:");
    if (!p) return 0;

    p = strchr(p, ':');
    if (!p) return 0;
    p++;

    while (*p == ' ') p++;

    if (_strnicmp(p, "Bearer ", 7) != 0)
        return 0;

    p += 7;

    size_t n = 0;
    while (*p && *p != '\r' && *p != '\n' && n + 1 < cap)
        token[n++] = *p++;

    token[n] = '\0';
    return n > 0;
}

static int current_user_id(const char *token)
{
    if (!token || !*token) return 0;

    char esc[256], sql[1024];
    sql_escape(token, esc, sizeof(esc));

    snprintf(sql, sizeof(sql),
        "SELECT user_id FROM sessions "
        "WHERE token='%s' AND expires_at > NOW() LIMIT 1",
        esc);

    if (mysql_query(db, sql) != 0) return 0;

    MYSQL_RES *res = mysql_store_result(db);
    if (!res) return 0;

    MYSQL_ROW row = mysql_fetch_row(res);
    int id = row ? atoi(row[0]) : 0;
    mysql_free_result(res);
    return id;
}

/* =========================================================
   Register / Login / Logout
   ========================================================= */

static void api_register(SOCKET client, const char *body)
{
    char username[101] = "", password[256] = "", role[32] = "student";
    char hash[65], eu[256], er[64], ename[256], sql[2048];

    if (!json_get_string(body, "username", username, sizeof(username)) ||
        !json_get_string(body, "password", password, sizeof(password)))
    {
        send_text(client, 400, "{\"success\":false,\"message\":\"Username and password are required\"}");
        return;
    }

    json_get_string(body, "role", role, sizeof(role));

    if (strcmp(role, "teacher") != 0 && strcmp(role, "student") != 0)
        strcpy(role, "student");

    if (!sha256_hex(password, hash, sizeof(hash))) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Password hashing failed\"}");
        return;
    }

    sql_escape(username, eu, sizeof(eu));
    sql_escape(role, er, sizeof(er));

    snprintf(sql, sizeof(sql),
        "SELECT id FROM users WHERE username='%s' LIMIT 1", eu);

    if (mysql_query(db, sql) != 0) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
        return;
    }

    MYSQL_RES *res = mysql_store_result(db);
    MYSQL_ROW row = res ? mysql_fetch_row(res) : NULL;

    if (row) {
        mysql_free_result(res);
        send_text(client, 409, "{\"success\":false,\"message\":\"Username already exists\"}");
        return;
    }
    if (res) mysql_free_result(res);

    sql_escape(username, ename, sizeof(ename));

    snprintf(sql, sizeof(sql),
        "INSERT INTO users(username,password,role,name) "
        "VALUES('%s','%s','%s','%s')",
        eu, hash, er, ename);

    if (!db_exec(sql)) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not create user\"}");
        return;
    }

    int id = (int)mysql_insert_id(db);

    char token[65];
    if (!make_token(token, sizeof(token))) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not create session\"}");
        return;
    }

    char et[128];
    sql_escape(token, et, sizeof(et));

    snprintf(sql, sizeof(sql),
        "INSERT INTO sessions(user_id,token,expires_at) "
        "VALUES(%d,'%s',DATE_ADD(NOW(),INTERVAL 24 HOUR))",
        id, et);

    if (!db_exec(sql)) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not create session\"}");
        return;
    }

    char ej[256];
    json_escape(username, ej, sizeof(ej));

    char response[1024];
    snprintf(response, sizeof(response),
        "{\"success\":true,\"message\":\"Registration successful\","
        "\"token\":\"%s\",\"user_id\":%d,\"username\":\"%s\",\"role\":\"%s\"}",
        token, id, ej, role);

    send_text(client, 201, response);
}

static void api_login(SOCKET client, const char *body)
{
    char username[101] = "", password[256] = "", role[32] = "student";
    char hash[65], eu[256], er[64], sql[2048];

    if (!json_get_string(body, "username", username, sizeof(username)) ||
        !json_get_string(body, "password", password, sizeof(password)))
    {
        send_text(client, 400, "{\"success\":false,\"message\":\"Username and password are required\"}");
        return;
    }

    json_get_string(body, "role", role, sizeof(role));

    sha256_hex(password, hash, sizeof(hash));
    sql_escape(username, eu, sizeof(eu));
    sql_escape(role, er, sizeof(er));

    snprintf(sql, sizeof(sql),
        "SELECT id,username,role,name FROM users "
        "WHERE username='%s' AND password='%s' AND role='%s' LIMIT 1",
        eu, hash, er);

    if (mysql_query(db, sql) != 0) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
        return;
    }

    MYSQL_RES *res = mysql_store_result(db);
    MYSQL_ROW row = res ? mysql_fetch_row(res) : NULL;

    if (!row) {
        if (res) mysql_free_result(res);
        send_text(client, 401, "{\"success\":false,\"message\":\"Incorrect username, password, or role\"}");
        return;
    }

    int id = atoi(row[0]);
    char db_username[101], db_role[32], db_name[151];
    strncpy(db_username, row[1], sizeof(db_username)-1);
    strncpy(db_role, row[2], sizeof(db_role)-1);
    strncpy(db_name, row[3], sizeof(db_name)-1);

    mysql_free_result(res);

    char token[65];
    if (!make_token(token, sizeof(token))) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not create session\"}");
        return;
    }

    char et[128];
    sql_escape(token, et, sizeof(et));

    snprintf(sql, sizeof(sql),
        "INSERT INTO sessions(user_id,token,expires_at) "
        "VALUES(%d,'%s',DATE_ADD(NOW(),INTERVAL 24 HOUR))",
        id, et);

    if (!db_exec(sql)) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not create session\"}");
        return;
    }

    char euj[256], enj[256];
    json_escape(db_username, euj, sizeof(euj));
    json_escape(db_name, enj, sizeof(enj));

    char response[1200];
    snprintf(response, sizeof(response),
        "{\"success\":true,\"message\":\"Login successful\","
        "\"token\":\"%s\",\"user_id\":%d,\"username\":\"%s\","
        "\"role\":\"%s\",\"name\":\"%s\"}",
        token, id, euj, db_role, enj);

    send_text(client, 200, response);
}

static void api_logout(SOCKET client, const char *raw)
{
    char token[128];

    if (!get_authorization_token(raw, token, sizeof(token))) {
        send_text(client, 200, "{\"success\":true,\"message\":\"Logged out\"}");
        return;
    }

    char et[256], sql[512];
    sql_escape(token, et, sizeof(et));

    snprintf(sql, sizeof(sql),
        "DELETE FROM sessions WHERE token='%s'", et);

    db_exec(sql);

    send_text(client, 200, "{\"success\":true,\"message\":\"Logged out\"}");
}

/* =========================================================
   Profile
   ========================================================= */

static void api_profile_get(SOCKET client, int user_id)
{
    if (!user_id) {
        send_text(client, 401, "{\"success\":false,\"message\":\"Unauthorized\"}");
        return;
    }

    char sql[512];
    snprintf(sql, sizeof(sql),
        "SELECT id,username,role,name,age,section,school,COALESCE(picture,'') "
        "FROM users WHERE id=%d LIMIT 1", user_id);

    if (mysql_query(db, sql) != 0) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
        return;
    }

    MYSQL_RES *res = mysql_store_result(db);
    MYSQL_ROW r = res ? mysql_fetch_row(res) : NULL;

    if (!r) {
        if (res) mysql_free_result(res);
        send_text(client, 404, "{\"success\":false,\"message\":\"User not found\"}");
        return;
    }

    char eusername[256], erole[64], ename[512], eage[128],
         esection[256], eschool[512], epicture[LARGE];

    json_escape(r[1], eusername, sizeof(eusername));
    json_escape(r[2], erole, sizeof(erole));
    json_escape(r[3], ename, sizeof(ename));
    json_escape(r[4] ? r[4] : "", eage, sizeof(eage));
    json_escape(r[5] ? r[5] : "", esection, sizeof(esection));
    json_escape(r[6] ? r[6] : "", eschool, sizeof(eschool));
    json_escape(r[7] ? r[7] : "", epicture, sizeof(epicture));

    char response[LARGE];
    snprintf(response, sizeof(response),
        "{\"success\":true,\"user\":{"
        "\"id\":%s,\"username\":\"%s\",\"role\":\"%s\",\"name\":\"%s\","
        "\"age\":\"%s\",\"section\":\"%s\",\"school\":\"%s\",\"picture\":\"%s\""
        "}}",
        r[0], eusername, erole, ename, eage, esection, eschool, epicture);

    mysql_free_result(res);
    send_text(client, 200, response);
}

static void api_profile_post(SOCKET client, int user_id, const char *body)
{
    if (!user_id) {
        send_text(client, 401, "{\"success\":false,\"message\":\"Unauthorized\"}");
        return;
    }

    char name[151] = "", age[21] = "", section[101] = "",
         school[151] = "", picture[LARGE] = "";

    json_get_string(body, "name", name, sizeof(name));
    json_get_string(body, "age", age, sizeof(age));
    json_get_string(body, "section", section, sizeof(section));
    json_get_string(body, "school", school, sizeof(school));
    json_get_string(body, "picture", picture, sizeof(picture));

    char ename[512], eage[128], esection[256], eschool[512], epicture[LARGE], sql[LARGE];
    sql_escape(name, ename, sizeof(ename));
    sql_escape(age, eage, sizeof(eage));
    sql_escape(section, esection, sizeof(esection));
    sql_escape(school, eschool, sizeof(eschool));
    sql_escape(picture, epicture, sizeof(epicture));

    snprintf(sql, sizeof(sql),
        "UPDATE users SET name='%s',age='%s',section='%s',school='%s',picture='%s' "
        "WHERE id=%d",
        ename, eage, esection, eschool, epicture, user_id);

    if (!db_exec(sql)) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not update profile\"}");
        return;
    }

    send_text(client, 200, "{\"success\":true,\"message\":\"Profile updated\"}");
}

/* =========================================================
   Exams
   ========================================================= */

static void api_exams_list(SOCKET client, int user_id, const char *query)
{
    (void)user_id;
    char idstr[64];

    if (get_query_value(query, "id", idstr, sizeof(idstr))) {
        int exam_id = atoi(idstr);
        char sql[512];

        snprintf(sql, sizeof(sql),
            "SELECT e.id,e.exam_code,e.title,COALESCE(e.description,''),"
            "e.teacher_id,e.deadline,"
            "COALESCE(u.username,''),COALESCE(u.name,''),"
            "COUNT(q.id) "
            "FROM exams e "
            "LEFT JOIN users u ON u.id=e.teacher_id "
            "LEFT JOIN questions q ON q.exam_id=e.id "
            "WHERE e.id=%d GROUP BY e.id LIMIT 1",
            exam_id);

        if (mysql_query(db, sql) != 0) {
            send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
            return;
        }

        MYSQL_RES *res = mysql_store_result(db);
        MYSQL_ROW r = res ? mysql_fetch_row(res) : NULL;

        if (!r) {
            if (res) mysql_free_result(res);
            send_text(client, 404, "{\"success\":false,\"message\":\"Exam not found\"}");
            return;
        }

        char ec[128], et[512], ed[2048], tu[256], tn[512];
        json_escape(r[1], ec, sizeof(ec));
        json_escape(r[2], et, sizeof(et));
        json_escape(r[3], ed, sizeof(ed));
        json_escape(r[6] ? r[6] : "", tu, sizeof(tu));
        json_escape(r[7] ? r[7] : "", tn, sizeof(tn));

        char response[LARGE];
        snprintf(response, sizeof(response),
            "{\"success\":true,\"exam\":{"
            "\"id\":%s,\"exam_code\":\"%s\",\"title\":\"%s\","
            "\"description\":\"%s\",\"teacher_id\":%s,\"deadline\":\"%s\","
            "\"teacher_username\":\"%s\",\"teacher_name\":\"%s\",\"questions\":[",
            r[0], ec, et, ed, r[4], r[5], tu, tn);

        mysql_free_result(res);

        snprintf(sql, sizeof(sql),
            "SELECT id,question_number,question_text,question_type,"
            "COALESCE(choice_a,''),COALESCE(choice_b,''),COALESCE(choice_c,''),"
            "COALESCE(choice_d,''),COALESCE(correct_answer,''),points "
            "FROM questions WHERE exam_id=%d ORDER BY question_number",
            exam_id);

        if (mysql_query(db, sql) != 0) {
            send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
            return;
        }

        res = mysql_store_result(db);
        int first = 1;
        while ((r = mysql_fetch_row(res)) != NULL) {
            char q[4096], qa[1024], qb[1024], qc[1024], qd[1024], qtype[64], qcorrect[1024];
            json_escape(r[2], q, sizeof(q));
            json_escape(r[4], qa, sizeof(qa));
            json_escape(r[5], qb, sizeof(qb));
            json_escape(r[6], qc, sizeof(qc));
            json_escape(r[7], qd, sizeof(qd));
            json_escape(r[3], qtype, sizeof(qtype));
            json_escape(r[8], qcorrect, sizeof(qcorrect));

            char item[8192];
            snprintf(item, sizeof(item),
                "%s{\"id\":%s,\"question_id\":%s,\"question_number\":%s,"
                "\"question_text\":\"%s\",\"question_type\":\"%s\","
                "\"choice_a\":\"%s\",\"choice_b\":\"%s\",\"choice_c\":\"%s\","
                "\"choice_d\":\"%s\",\"correct_answer\":\"%s\",\"points\":%s}",
                first ? "" : ",",
                r[0], r[0], r[1], q, qtype, qa, qb, qc, qd, qcorrect, r[9]);

            strncat(response, item, sizeof(response)-strlen(response)-1);
            first = 0;
        }
        mysql_free_result(res);

        strncat(response, "]}}", sizeof(response)-strlen(response)-1);
        send_text(client, 200, response);
        return;
    }

    const char *sql =
        "SELECT e.id,e.exam_code,e.title,COALESCE(e.description,''),"
        "e.teacher_id,e.deadline,COALESCE(u.username,''),COALESCE(u.name,'') "
        "FROM exams e LEFT JOIN users u ON u.id=e.teacher_id "
        "ORDER BY e.created_at DESC";

    if (mysql_query(db, sql) != 0) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
        return;
    }

    MYSQL_RES *res = mysql_store_result(db);
    MYSQL_ROW r;
    char response[LARGE] = "{\"success\":true,\"exams\":[";
    int first = 1;

    while ((r = mysql_fetch_row(res)) != NULL) {
        char ec[128], et[512], ed[2048], tu[256], tn[512];
        json_escape(r[1], ec, sizeof(ec));
        json_escape(r[2], et, sizeof(et));
        json_escape(r[3], ed, sizeof(ed));
        json_escape(r[6] ? r[6] : "", tu, sizeof(tu));
        json_escape(r[7] ? r[7] : "", tn, sizeof(tn));

        char item[4096];
        snprintf(item, sizeof(item),
            "%s{\"id\":%s,\"exam_code\":\"%s\",\"title\":\"%s\","
            "\"description\":\"%s\",\"teacher_id\":%s,\"deadline\":\"%s\","
            "\"teacher_username\":\"%s\",\"teacher_name\":\"%s\"}",
            first ? "" : ",", r[0], ec, et, ed, r[4], r[5], tu, tn);

        strncat(response, item, sizeof(response)-strlen(response)-1);
        first = 0;
    }

    mysql_free_result(res);
    strncat(response, "]}", sizeof(response)-strlen(response)-1);
    send_text(client, 200, response);
}

static int insert_questions(int exam_id, const char *questions)
{
    size_t pos = 0;
    char object[MEDIUM];

    while (extract_object(questions, &pos, object, sizeof(object))) {
        char text[4096] = "", type[32] = "mcq";
        char a[2048] = "", b[2048] = "", c[2048] = "", d[2048] = "";
        char correct[2048] = "";
        int number = 1, points = 1;

        json_get_int(object, "question_number", &number);
        json_get_int(object, "number", &number);
        json_get_int(object, "points", &points);

        json_get_string(object, "question_text", text, sizeof(text));
        json_get_string(object, "question", text, sizeof(text));
        json_get_string(object, "text", text, sizeof(text));
        json_get_string(object, "question_type", type, sizeof(type));
        json_get_string(object, "type", type, sizeof(type));

        json_get_string(object, "choice_a", a, sizeof(a));
        json_get_string(object, "choiceA", a, sizeof(a));
        json_get_string(object, "choice_b", b, sizeof(b));
        json_get_string(object, "choiceB", b, sizeof(b));
        json_get_string(object, "choice_c", c, sizeof(c));
        json_get_string(object, "choiceC", c, sizeof(c));
        json_get_string(object, "choice_d", d, sizeof(d));
        json_get_string(object, "choiceD", d, sizeof(d));
        json_get_string(object, "correct_answer", correct, sizeof(correct));
        json_get_string(object, "correctAnswer", correct, sizeof(correct));

        char et[8192], ea[4096], eb[4096], ec[4096], ed[4096], ex[4096], sql[32768];
        sql_escape(text, et, sizeof(et));
        sql_escape(a, ea, sizeof(ea));
        sql_escape(b, eb, sizeof(eb));
        sql_escape(c, ec, sizeof(ec));
        sql_escape(d, ed, sizeof(ed));
        sql_escape(correct, ex, sizeof(ex));

        snprintf(sql, sizeof(sql),
            "INSERT INTO questions("
            "exam_id,question_number,question_text,question_type,"
            "choice_a,choice_b,choice_c,choice_d,correct_answer,points)"
            "VALUES(%d,%d,'%s','%s','%s','%s','%s','%s','%s',%d)",
            exam_id, number, et, type, ea, eb, ec, ed, ex, points);

        if (!db_exec(sql)) return 0;
    }

    return 1;
}

static void api_exam_create(SOCKET client, int user_id, const char *body)
{
    if (!user_id) {
        send_text(client, 401, "{\"success\":false,\"message\":\"Unauthorized\"}");
        return;
    }

    char role[32] = "";
    char title[256] = "", code[101] = "", deadline[64] = "", description[1024] = "";
    char questions[LARGE] = "";
    int duration = 60;

    char sql[32768];

    snprintf(sql, sizeof(sql),
        "SELECT role FROM users WHERE id=%d LIMIT 1", user_id);

    if (mysql_query(db, sql) != 0) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
        return;
    }

    MYSQL_RES *role_res = mysql_store_result(db);
    MYSQL_ROW rr = role_res ? mysql_fetch_row(role_res) : NULL;
    if (rr) strncpy(role, rr[0], sizeof(role)-1);
    if (role_res) mysql_free_result(role_res);

    if (strcmp(role, "teacher") != 0) {
        send_text(client, 403, "{\"success\":false,\"message\":\"Only teachers can create exams\"}");
        return;
    }

    if (!json_get_string(body, "title", title, sizeof(title)) ||
        !json_get_string(body, "exam_code", code, sizeof(code)) ||
        !json_get_string(body, "deadline", deadline, sizeof(deadline)))
    {
        send_text(client, 400, "{\"success\":false,\"message\":\"title, exam_code and deadline are required\"}");
        return;
    }

    json_get_string(body, "description", description, sizeof(description));
    json_get_int(body, "duration", &duration);
    json_get_raw(body, "questions", questions, sizeof(questions));

    char et[512], ec[256], ed[2048], el[128];
    sql_escape(title, et, sizeof(et));
    sql_escape(code, ec, sizeof(ec));
    sql_escape(description, ed, sizeof(ed));
    sql_escape(deadline, el, sizeof(el));

    snprintf(sql, sizeof(sql),
        "INSERT INTO exams(exam_code,title,description,teacher_id,deadline) "
        "VALUES('%s','%s','%s',%d,'%s')",
        ec, et, ed, user_id, el);

    if (!db_exec(sql)) {
        send_text(client, 409, "{\"success\":false,\"message\":\"Could not create exam. Exam code may already exist.\"}");
        return;
    }

    int exam_id = (int)mysql_insert_id(db);

    (void)duration; /* Duration is accepted by the API; schema can be extended with a duration column. */

    if (questions[0] && !insert_questions(exam_id, questions)) {
        char del[256];
        snprintf(del, sizeof(del), "DELETE FROM exams WHERE id=%d", exam_id);
        db_exec(del);
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not save exam questions\"}");
        return;
    }

    char response[512];
    snprintf(response, sizeof(response),
        "{\"success\":true,\"message\":\"Exam created\",\"exam_id\":%d}",
        exam_id);

    send_text(client, 201, response);
}

/* =========================================================
   Submissions
   ========================================================= */

static int insert_answers(int submission_id, const char *answers)
{
    size_t pos = 0;
    char object[MEDIUM];

    while (extract_object(answers, &pos, object, sizeof(object))) {
        int question_id = 0;
        char answer[8192] = "";

        json_get_int(object, "question_id", &question_id);
        json_get_string(object, "answer", answer, sizeof(answer));

        if (!question_id) continue;

        char ea[16384], sql[20000];
        sql_escape(answer, ea, sizeof(ea));

        snprintf(sql, sizeof(sql),
            "INSERT INTO answers(submission_id,question_id,answer) "
            "VALUES(%d,%d,'%s')",
            submission_id, question_id, ea);

        if (!db_exec(sql)) return 0;
    }

    return 1;
}

static void api_submit(SOCKET client, int user_id, const char *body)
{
    if (!user_id) {
        send_text(client, 401, "{\"success\":false,\"message\":\"Unauthorized\"}");
        return;
    }

    int exam_id = 0;
    char answers[LARGE] = "";

    if (!json_get_int(body, "exam_id", &exam_id) ||
        !json_get_raw(body, "answers", answers, sizeof(answers)))
    {
        send_text(client, 400, "{\"success\":false,\"message\":\"exam_id and answers are required\"}");
        return;
    }

    char sql[4096];

    snprintf(sql, sizeof(sql),
        "SELECT id FROM submissions WHERE exam_id=%d AND student_id=%d LIMIT 1",
        exam_id, user_id);

    if (mysql_query(db, sql) != 0) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
        return;
    }

    MYSQL_RES *res = mysql_store_result(db);
    MYSQL_ROW r = res ? mysql_fetch_row(res) : NULL;

    if (r) {
        int submission_id = atoi(r[0]);
        mysql_free_result(res);

        snprintf(sql, sizeof(sql),
            "DELETE FROM answers WHERE submission_id=%d", submission_id);
        db_exec(sql);

        if (!insert_answers(submission_id, answers)) {
            send_text(client, 500, "{\"success\":false,\"message\":\"Could not update answers\"}");
            return;
        }

        snprintf(sql, sizeof(sql),
            "UPDATE submissions SET submitted_at=NOW(),status='submitted' "
            "WHERE id=%d", submission_id);
        db_exec(sql);

        send_text(client, 200, "{\"success\":true,\"message\":\"Submission updated\"}");
        return;
    }

    if (res) mysql_free_result(res);

    snprintf(sql, sizeof(sql),
        "INSERT INTO submissions(exam_id,student_id,status) "
        "VALUES(%d,%d,'submitted')",
        exam_id, user_id);

    if (!db_exec(sql)) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not create submission\"}");
        return;
    }

    int submission_id = (int)mysql_insert_id(db);

    if (!insert_answers(submission_id, answers)) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not save answers\"}");
        return;
    }

    char response[512];
    snprintf(response, sizeof(response),
        "{\"success\":true,\"message\":\"Exam submitted\",\"submission_id\":%d}",
        submission_id);

    send_text(client, 201, response);
}

/* =========================================================
   Results
   ========================================================= */

static void api_results(SOCKET client, int user_id, const char *query)
{
    if (!user_id) {
        send_text(client, 401, "{\"success\":false,\"message\":\"Unauthorized\"}");
        return;
    }

    char role[32] = "";
    char sql[4096];

    snprintf(sql, sizeof(sql),
        "SELECT role FROM users WHERE id=%d LIMIT 1", user_id);

    if (mysql_query(db, sql) != 0) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
        return;
    }

    MYSQL_RES *rrs = mysql_store_result(db);
    MYSQL_ROW rr = rrs ? mysql_fetch_row(rrs) : NULL;
    if (rr) strncpy(role, rr[0], sizeof(role)-1);
    if (rrs) mysql_free_result(rrs);

    char exam_id_str[64] = "";
    get_query_value(query, "exam_id", exam_id_str, sizeof(exam_id_str));

    if (strcmp(role, "teacher") == 0) {
        if (exam_id_str[0]) {
            int exam_id = atoi(exam_id_str);

            snprintf(sql, sizeof(sql),
                "SELECT s.id,s.exam_id,s.student_id,s.status,s.score,s.submitted_at,"
                "u.username,u.name,e.title "
                "FROM submissions s "
                "JOIN users u ON u.id=s.student_id "
                "JOIN exams e ON e.id=s.exam_id "
                "WHERE s.exam_id=%d AND e.teacher_id=%d "
                "ORDER BY s.submitted_at DESC",
                exam_id, user_id);
        } else {
            snprintf(sql, sizeof(sql),
                "SELECT s.id,s.exam_id,s.student_id,s.status,s.score,s.submitted_at,"
                "u.username,u.name,e.title "
                "FROM submissions s "
                "JOIN users u ON u.id=s.student_id "
                "JOIN exams e ON e.id=s.exam_id "
                "WHERE e.teacher_id=%d "
                "ORDER BY s.submitted_at DESC",
                user_id);
        }
    } else {
        snprintf(sql, sizeof(sql),
            "SELECT s.id,s.exam_id,s.student_id,s.status,s.score,s.submitted_at,"
            "u.username,u.name,e.title "
            "FROM submissions s "
            "JOIN users u ON u.id=s.student_id "
            "JOIN exams e ON e.id=s.exam_id "
            "WHERE s.student_id=%d AND s.status='released' "
            "ORDER BY s.submitted_at DESC",
            user_id);
    }

    if (mysql_query(db, sql) != 0) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
        return;
    }

    MYSQL_RES *res = mysql_store_result(db);
    MYSQL_ROW r;

    char response[LARGE] = "{\"success\":true,\"results\":[";
    int first = 1;

    while ((r = mysql_fetch_row(res)) != NULL) {
        char username[256], name[512], title[512];
        json_escape(r[6], username, sizeof(username));
        json_escape(r[7], name, sizeof(name));
        json_escape(r[8], title, sizeof(title));

        char item[4096];
        snprintf(item, sizeof(item),
            "%s{\"id\":%s,\"submission_id\":%s,\"exam_id\":%s,"
            "\"student_id\":%s,\"status\":\"%s\",\"score\":%s,"
            "\"submitted_at\":\"%s\",\"student_username\":\"%s\","
            "\"student_name\":\"%s\",\"exam_title\":\"%s\"}",
            first ? "" : ",",
            r[0], r[0], r[1], r[2], r[3], r[4],
            r[5], username, name, title);

        strncat(response, item, sizeof(response)-strlen(response)-1);
        first = 0;
    }

    mysql_free_result(res);

    strncat(response, "]}", sizeof(response)-strlen(response)-1);
    send_text(client, 200, response);
}

static void api_release(SOCKET client, int teacher_id, const char *body)
{
    if (!teacher_id) {
        send_text(client, 401, "{\"success\":false,\"message\":\"Unauthorized\"}");
        return;
    }

    int submission_id = 0;
    char scores[LARGE] = "";

    json_get_int(body, "submission_id", &submission_id);
    json_get_raw(body, "essay_scores", scores, sizeof(scores));

    char sql[4096];

    snprintf(sql, sizeof(sql),
        "SELECT e.teacher_id FROM submissions s "
        "JOIN exams e ON e.id=s.exam_id "
        "WHERE s.id=%d LIMIT 1",
        submission_id);

    if (mysql_query(db, sql) != 0) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Database error\"}");
        return;
    }

    MYSQL_RES *res = mysql_store_result(db);
    MYSQL_ROW r = res ? mysql_fetch_row(res) : NULL;

    if (!r || atoi(r[0]) != teacher_id) {
        if (res) mysql_free_result(res);
        send_text(client, 403, "{\"success\":false,\"message\":\"You cannot release this result\"}");
        return;
    }

    if (res) mysql_free_result(res);

    /* Save essay scores if provided. */
    if (scores[0]) {
        size_t pos = 0;
        char object[MEDIUM];

        while (extract_object(scores, &pos, object, sizeof(object))) {
            int question_id = 0;
            double score = 0;

            json_get_int(object, "question_id", &question_id);
            if (!json_get_double(object, "score", &score))
                json_get_double(object, "essay_score", &score);

            snprintf(sql, sizeof(sql),
                "UPDATE answers SET essay_score=%.2f "
                "WHERE submission_id=%d AND question_id=%d",
                score, submission_id, question_id);

            db_exec(sql);
        }
    }

    /* Recalculate score:
       objective questions use correct_answer;
       essay questions use essay_score.
    */
    snprintf(sql, sizeof(sql),
        "SELECT COALESCE(SUM("
        "CASE "
        "WHEN q.question_type='essay' THEN COALESCE(a.essay_score,0)"
        "WHEN LOWER(TRIM(a.answer))=LOWER(TRIM(q.correct_answer)) THEN q.points"
        "ELSE 0 END"
        "),0) "
        "FROM answers a JOIN questions q ON q.id=a.question_id "
        "WHERE a.submission_id=%d",
        submission_id);

    if (mysql_query(db, sql) != 0) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not calculate score\"}");
        return;
    }

    res = mysql_store_result(db);
    r = res ? mysql_fetch_row(res) : NULL;
    double score = r ? atof(r[0]) : 0;
    if (res) mysql_free_result(res);

    snprintf(sql, sizeof(sql),
        "UPDATE submissions SET score=%.2f,status='released',released_at=NOW() "
        "WHERE id=%d",
        score, submission_id);

    if (!db_exec(sql)) {
        send_text(client, 500, "{\"success\":false,\"message\":\"Could not release result\"}");
        return;
    }

    char response[512];
    snprintf(response, sizeof(response),
        "{\"success\":true,\"message\":\"Result released\",\"score\":%.2f}",
        score);

    send_text(client, 200, response);
}

/* =========================================================
   Request router
   ========================================================= */

static void handle_request(SOCKET client, char *raw)
{
    Request req;
    memset(&req, 0, sizeof(req));

    if (!parse_request(raw, &req)) {
        send_text(client, 400, "{\"success\":false,\"message\":\"Invalid HTTP request\"}");
        return;
    }

    if (_stricmp(req.method, "OPTIONS") == 0) {
        send_text(client, 200, "{\"success\":true}");
        return;
    }

    char token[128] = "";
    get_authorization_token(raw, token, sizeof(token));

    int user_id = current_user_id(token);

    if (_stricmp(req.path, "/api/register.php") == 0 &&
        _stricmp(req.method, "POST") == 0)
    {
        api_register(client, req.body);
        return;
    }

    if (_stricmp(req.path, "/api/login.php") == 0 &&
        _stricmp(req.method, "POST") == 0)
    {
        api_login(client, req.body);
        return;
    }

    if (_stricmp(req.path, "/api/logout.php") == 0 &&
        _stricmp(req.method, "POST") == 0)
    {
        api_logout(client, raw);
        return;
    }

    if (_stricmp(req.path, "/api/profile.php") == 0) {
        if (_stricmp(req.method, "GET") == 0) {
            api_profile_get(client, user_id);
            return;
        }

        if (_stricmp(req.method, "POST") == 0 ||
            _stricmp(req.method, "PUT") == 0)
        {
            api_profile_post(client, user_id, req.body);
            return;
        }
    }

    if (_stricmp(req.path, "/api/exams.php") == 0) {
        if (_stricmp(req.method, "GET") == 0) {
            api_exams_list(client, user_id, req.query);
            return;
        }

        if (_stricmp(req.method, "POST") == 0) {
            api_exam_create(client, user_id, req.body);
            return;
        }
    }

    if (_stricmp(req.path, "/api/submissions.php") == 0) {
        if (_stricmp(req.method, "POST") == 0) {
            char action[64] = "";
            json_get_string(req.body, "action", action, sizeof(action));

            if (strcmp(action, "release") == 0 ||
                strcmp(action, "score_essay") == 0)
            {
                api_release(client, user_id, req.body);
            } else {
                api_submit(client, user_id, req.body);
            }
            return;
        }

        if (_stricmp(req.method, "GET") == 0) {
            api_results(client, user_id, req.query);
            return;
        }
    }

    if (_stricmp(req.path, "/api/results.php") == 0 &&
        _stricmp(req.method, "GET") == 0)
    {
        api_results(client, user_id, req.query);
        return;
    }

    send_text(client, 404,
        "{\"success\":false,\"message\":\"API endpoint not found\"}");
}

/* =========================================================
   Main server
   ========================================================= */

int main(void)
{
    WSADATA wsa;
    SOCKET server = INVALID_SOCKET;

    printf("============================================\n");
    printf("          TESTHUB C BACKEND SERVER\n");
    printf("============================================\n");

    if (WSAStartup(MAKEWORD(2,2), &wsa) != 0) {
        printf("WSAStartup failed.\n");
        return 1;
    }

    if (!db_connect()) {
        printf("\nMake sure XAMPP MariaDB/MySQL is RUNNING.\n");
        WSACleanup();
        return 1;
    }

    if (!db_setup()) {
        printf("Database table setup failed.\n");
        mysql_close(db);
        WSACleanup();
        return 1;
    }

    server = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);

    if (server == INVALID_SOCKET) {
        printf("Socket creation failed.\n");
        mysql_close(db);
        WSACleanup();
        return 1;
    }

    int opt = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR,
               (const char*)&opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(PORT);

    if (bind(server, (struct sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        printf("Bind failed. Is port %d already in use?\n", PORT);
        closesocket(server);
        mysql_close(db);
        WSACleanup();
        return 1;
    }

    if (listen(server, 10) == SOCKET_ERROR) {
        printf("Listen failed.\n");
        closesocket(server);
        mysql_close(db);
        WSACleanup();
        return 1;
    }

    printf("\nBackend is running:\n");
    printf("http://127.0.0.1:%d\n", PORT);
    printf("\nDatabase: testhub\n");
    printf("Database server: 127.0.0.1:%d\n", DB_PORT);
    printf("\nPress Ctrl+C to stop the server.\n\n");

    while (1) {
        SOCKET client = accept(server, NULL, NULL);

        if (client == INVALID_SOCKET)
            continue;

        char *buffer = (char*)calloc(1, BUFFER_SIZE);

        if (!buffer) {
            closesocket(client);
            continue;
        }

        int total = 0;

        while (total < BUFFER_SIZE - 1) {
            int received = recv(
                client,
                buffer + total,
                BUFFER_SIZE - 1 - total,
                0
            );

            if (received <= 0)
                break;

            total += received;
            buffer[total] = '\0';

            /* For this school/local server, one request fits in the buffer. */
            if (strstr(buffer, "\r\n\r\n"))
                break;
        }

        if (total > 0)
            handle_request(client, buffer);

        free(buffer);
        closesocket(client);
    }

    closesocket(server);
    mysql_close(db);
    WSACleanup();

    return 0;
}
