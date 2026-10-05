CREATE DATABASE IF NOT EXISTS testhub;
USE testhub;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('student','teacher') NOT NULL DEFAULT 'student',
    name VARCHAR(150) NOT NULL,
    age VARCHAR(20) DEFAULT '',
    section VARCHAR(100) DEFAULT 'N/A',
    school VARCHAR(150) DEFAULT 'N/A',
    picture LONGTEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exams (
    id INT AUTO_INCREMENT PRIMARY KEY,
    exam_code VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    teacher_id INT NOT NULL,
    deadline DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_exam_teacher FOREIGN KEY (teacher_id)
        REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    exam_id INT NOT NULL,
    question_number INT NOT NULL,
    question_text TEXT NOT NULL,
    question_type ENUM('mcq','tf','essay') NOT NULL,
    choice_a TEXT NULL,
    choice_b TEXT NULL,
    choice_c TEXT NULL,
    choice_d TEXT NULL,
    correct_answer TEXT NULL,
    points INT DEFAULT 1,
    CONSTRAINT fk_question_exam FOREIGN KEY (exam_id)
        REFERENCES exams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    exam_id INT NOT NULL,
    student_id INT NOT NULL,
    status ENUM('submitted','released','pending') DEFAULT 'submitted',
    score DECIMAL(10,2) DEFAULT 0,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY unique_exam_student (exam_id, student_id),
    CONSTRAINT fk_submission_exam FOREIGN KEY (exam_id)
        REFERENCES exams(id) ON DELETE CASCADE,
    CONSTRAINT fk_submission_student FOREIGN KEY (student_id)
        REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS answers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    submission_id INT NOT NULL,
    question_id INT NOT NULL,
    answer TEXT NULL,
    essay_score DECIMAL(10,2) NULL,
    CONSTRAINT fk_answer_submission FOREIGN KEY (submission_id)
        REFERENCES submissions(id) ON DELETE CASCADE,
    CONSTRAINT fk_answer_question FOREIGN KEY (question_id)
        REFERENCES questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_session_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
);
