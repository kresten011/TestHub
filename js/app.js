/* =========================================================
   TESTHUB JAVASCRIPT - MAIN APPLICATION LOGIC
   PHP + MYSQL VERSION
========================================================= */

const API = "api";
const SESSION = "testhub_session";

let questionCount = 0;
let currentExam = null;
let examInterval = null;


/* =========================================================
   DEFAULT AVATAR
========================================================= */

const defaultAvatar =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <rect width="100%" height="100%" fill="#e9ebf4"/>
      <circle cx="100" cy="78" r="42" fill="#aeb3c8"/>
      <path d="M35 190c8-50 122-50 130 0" fill="#aeb3c8"/>
    </svg>
  `);


/* =========================================================
   SESSION HELPERS
========================================================= */

function session() {
  return JSON.parse(
    localStorage.getItem(SESSION) || "null"
  );
}


function setSession(user) {
  localStorage.setItem(
    SESSION,
    JSON.stringify({
      id: user.id,
      username: user.username,
      role: user.role
    })
  );
}


function currentUser() {
  return session();
}


function logout() {
  localStorage.removeItem(SESSION);
  location.href = "index.html";
}


function requireAuth() {
  if (!session()) {
    location.href = "index.html";
    return false;
  }

  return true;
}


/* =========================================================
   GENERAL HELPERS
========================================================= */

function esc(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    character =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[character])
  );
}


function byId(id) {
  return document.getElementById(id);
}


function message(id, text, error = false) {
  const element = byId(id);

  if (!element) return;

  element.textContent = text;
  element.className =
    "message " + (error ? "error" : "success");
}


function parseDate(value) {
  if (!value) return null;

  let dateString = String(value);

  if (
    dateString.includes(" ") &&
    !dateString.includes("T")
  ) {
    dateString = dateString.replace(" ", "T");
  }

  const parsed = new Date(dateString);

  return isNaN(parsed.getTime())
    ? null
    : parsed;
}


function fmtDate(date) {
  if (!date) return "—";

  const parsed = parseDate(date);

  if (!parsed) {
    return String(date);
  }

  return parsed.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}


function daysFromNow(date) {
  const parsed = parseDate(date);

  if (!parsed) return 0;

  return parsed - new Date();
}


function normalizeQuestionType(type) {
  if (
    type === "multiple_choice" ||
    type === "mcq"
  ) {
    return "mcq";
  }

  if (
    type === "true_false" ||
    type === "tf"
  ) {
    return "tf";
  }

  return "essay";
}


function mysqlQuestionType(type) {
  if (type === "mcq") {
    return "multiple_choice";
  }

  if (type === "tf") {
    return "true_false";
  }

  return "essay";
}


function toMySQLDateTime(value) {
  if (!value) return "";

  let result =
    String(value).replace("T", " ");

  if (result.length === 16) {
    result += ":00";
  }

  return result;
}


/* =========================================================
   PAGE INITIALIZATION
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    document
      .querySelectorAll("[data-logout]")
      .forEach(button => {
        button.onclick = logout;
      });


    if (
      location.pathname.endsWith("index.html") ||
      location.pathname === "/" ||
      location.pathname === ""
    ) {
      initAuth();
      return;
    }


    if (!requireAuth()) return;


    const user = currentUser();


    if (!user) {
      logout();
      return;
    }


    const page =
      location.pathname
        .split("/")
        .pop();


    if (page === "dashboard.html") {
      initDashboard(user);
    }


    if (page === "profile.html") {
      initProfile(user);
    }


    if (page === "exams.html") {
      initExams(user);
    }


    if (page === "results.html") {
      initResults(user);
    }

  }
);


/* =========================================================
   AUTHENTICATION
========================================================= */

function initAuth() {

  if (session()) {
    location.href = "dashboard.html";
    return;
  }


  const loginView = byId("loginView");
  const registerView = byId("registerView");
  const showRegister = byId("showRegister");
  const showLogin = byId("showLogin");


  if (showRegister) {

    showRegister.addEventListener(
      "click",
      function(event) {

        event.preventDefault();
        event.stopPropagation();

        loginView?.classList.add("hidden");
        registerView?.classList.remove("hidden");

        const box = byId("authMessage");

        if (box) {
          box.textContent = "";
          box.className = "message";
        }

      }
    );

  }


  if (showLogin) {

    showLogin.addEventListener(
      "click",
      function(event) {

        event.preventDefault();
        event.stopPropagation();

        registerView?.classList.add("hidden");
        loginView?.classList.remove("hidden");

        const box = byId("authMessage");

        if (box) {
          box.textContent = "";
          box.className = "message";
        }

      }
    );

  }


  function setupRoleSwitch(viewId) {

    const view = byId(viewId);

    if (!view) return;

    const options =
      view.querySelectorAll(".role-option");


    options.forEach(option => {

      const radio =
        option.querySelector(
          'input[type="radio"]'
        );


      option.addEventListener(
        "click",
        function(event) {

          event.stopPropagation();

          if (radio) {
            radio.checked = true;
          }

          options.forEach(other => {
            other.classList.remove("active");
          });

          option.classList.add("active");

        }
      );


      if (radio) {

        radio.addEventListener(
          "change",
          function() {

            options.forEach(other => {
              other.classList.remove("active");
            });

            option.classList.add("active");

          }
        );

      }

    });

  }


  setupRoleSwitch("loginView");
  setupRoleSwitch("registerView");


  setupPasswordToggle(
    "loginPassword",
    "loginShowPassword"
  );


  setupPasswordToggle(
    "registerPassword",
    "registerShowPassword"
  );


  /* =======================================================
     REGISTER
  ======================================================= */

  const registerForm = byId("registerForm");


  if (registerForm) {

    registerForm.addEventListener(
      "submit",
      async function(event) {

        event.preventDefault();


        const username =
          byId("registerUsername")
            ?.value
            .trim() || "";


        const password =
          byId("registerPassword")
            ?.value || "";


        const selectedRole =
          document.querySelector(
            'input[name="registerRoleRadio"]:checked'
          );


        const role =
          selectedRole?.value || "student";


        if (!username) {
          return message(
            "authMessage",
            "Please enter a username.",
            true
          );
        }


        if (!password) {
          return message(
            "authMessage",
            "Please enter a password.",
            true
          );
        }


        if (password.length < 6) {
          return message(
            "authMessage",
            "Password must be at least 6 characters.",
            true
          );
        }


        try {

          const response =
            await fetch(
              `${API}/register.php`,
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify({
                    username,
                    password,
                    role
                  })
              }
            );


          const data =
            await response.json();


          if (!data.success) {

            return message(
              "authMessage",
              data.message ||
                "Registration failed.",
              true
            );

          }


          setSession(data.user);


          message(
            "authMessage",
            "Account created successfully!"
          );


          setTimeout(
            () => {
              location.href =
                "dashboard.html";
            },
            500
          );


        } catch (error) {

          console.error(error);

          message(
            "authMessage",
            "Unable to connect to the server.",
            true
          );

        }

      }
    );

  }


  /* =======================================================
     LOGIN
  ======================================================= */

  const loginForm = byId("loginForm");


  if (loginForm) {

    loginForm.addEventListener(
      "submit",
      async function(event) {

        event.preventDefault();


        const username =
          byId("loginUsername")
            ?.value
            .trim() || "";


        const password =
          byId("loginPassword")
            ?.value || "";


        const selectedRole =
          document.querySelector(
            'input[name="loginRoleRadio"]:checked'
          );


        const role =
          selectedRole?.value || "student";


        if (!username) {
          return message(
            "authMessage",
            "Please enter a username.",
            true
          );
        }


        if (!password) {
          return message(
            "authMessage",
            "Please enter a password.",
            true
          );
        }


        try {

          const response =
            await fetch(
              `${API}/login.php`,
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify({
                    username,
                    password,
                    role
                  })
              }
            );


          const data =
            await response.json();


          if (!data.success) {

            return message(
              "authMessage",
              data.message ||
                "Login failed.",
              true
            );

          }


          setSession(data.user);


          message(
            "authMessage",
            "Login successful!"
          );


          setTimeout(
            () => {
              location.href =
                "dashboard.html";
            },
            500
          );


        } catch (error) {

          console.error(error);

          message(
            "authMessage",
            "Unable to connect to the server.",
            true
          );

        }

      }
    );

  }

}


/* =========================================================
   PASSWORD TOGGLE
========================================================= */

function setupPasswordToggle(
  passwordId,
  buttonId
) {

  const password = byId(passwordId);
  const button = byId(buttonId);

  if (!password || !button) return;


  button.addEventListener(
    "click",
    function(event) {

      event.preventDefault();
      event.stopPropagation();


      if (password.type === "password") {

        password.type = "text";
        button.textContent = "Hide";

      } else {

        password.type = "password";
        button.textContent = "Show";

      }

    }
  );

}


/* =========================================================
   PROFILE
========================================================= */

function initProfile(user) {

  const roleLabel =
    user.role === "teacher"
      ? "Teacher"
      : "Student";


  if (byId("profileUsername")) {
    byId("profileUsername").textContent =
      user.username;
  }


  if (byId("profileRole")) {
    byId("profileRole").textContent =
      roleLabel;
  }


  if (byId("headerRole")) {
    byId("headerRole").textContent =
      roleLabel;
  }


  loadProfileFromDatabase(user);


  document
    .querySelectorAll(".field-change")
    .forEach(button => {

      button.onclick = () => {

        const target =
          byId(button.dataset.target);


        if (target) {

          target.focus();

          if (
            typeof target.select ===
            "function"
          ) {
            target.select();
          }

        }

      };

    });


  const pictureInput =
    byId("profilePicture");


  if (pictureInput) {

    pictureInput.onchange =
      event => {

        const file =
          event.target.files[0];


        if (!file) return;


        const reader =
          new FileReader();


        reader.onload =
          () => {

            const image =
              byId("profilePreview");


            const topAvatar =
              byId("topAvatar");


            if (image) {
              image.src =
                reader.result;
            }


            if (topAvatar) {
              topAvatar.src =
                reader.result;
            }

          };


        reader.readAsDataURL(file);

      };

  }


  const profileForm =
    byId("profileForm");


  if (profileForm) {

    profileForm.onsubmit =
      async event => {

        event.preventDefault();


        const name =
          byId("profileName")
            ?.value
            .trim() || "";


        const age =
          byId("profileAge")
            ?.value || "";


        const section =
          byId("profileSection")
            ?.value
            .trim() || "";


        const school =
          byId("profileSchool")
            ?.value
            .trim() || "";


        const profilePreview =
          byId("profilePreview");


        const profilePicture =
          profilePreview?.src || null;


        if (!name) {

          return message(
            "profileMessage",
            "Please enter your name.",
            true
          );

        }


        try {

          const response =
            await fetch(
              `${API}/profile.php`,
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify({
                    user_id: user.id,
                    name,
                    age,
                    section,
                    school,
                    profile_picture:
                      profilePicture
                  })
              }
            );


          const data =
            await response.json();


          if (!data.success) {

            return message(
              "profileMessage",
              data.message ||
                "Failed to save profile.",
              true
            );

          }


          if (byId("profileDisplayName")) {
            byId("profileDisplayName")
              .textContent = name;
          }


          if (
            byId("topAvatar") &&
            profilePicture
          ) {
            byId("topAvatar").src =
              profilePicture;
          }


          message(
            "profileMessage",
            "Profile saved successfully."
          );


        } catch (error) {

          console.error(error);

          message(
            "profileMessage",
            "Unable to connect to the server.",
            true
          );

        }

      };

  }

}


/* =========================================================
   LOAD PROFILE
========================================================= */

async function loadProfileFromDatabase(user) {

  try {

    const response =
      await fetch(
        `${API}/profile.php?user_id=${encodeURIComponent(
          user.id
        )}`
      );


    const data =
      await response.json();


    if (!data.success) {

      return message(
        "profileMessage",
        data.message ||
          "Unable to load profile.",
        true
      );

    }


    const profile = data.user;


    if (byId("profileName")) {
      byId("profileName").value =
        profile.name ||
        user.username;
    }


    if (byId("profileAge")) {
      byId("profileAge").value =
        profile.age || "";
    }


    if (byId("profileSection")) {
      byId("profileSection").value =
        profile.section || "";
    }


    if (byId("profileSchool")) {
      byId("profileSchool").value =
        profile.school || "";
    }


    if (byId("profileDisplayName")) {
      byId("profileDisplayName").textContent =
        profile.name ||
        user.username;
    }


    const picture =
      profile.profile_picture ||
      defaultAvatar;


    if (byId("profilePreview")) {
      byId("profilePreview").src =
        picture;
    }


    if (byId("topAvatar")) {
      byId("topAvatar").src =
        picture;
    }


  } catch (error) {

    console.error(error);

    message(
      "profileMessage",
      "Unable to connect to the server.",
      true
    );

  }

}


/* =========================================================
   DASHBOARD
========================================================= */

function initDashboard(user) {

  if (byId("greeting")) {
    byId("greeting").textContent =
      `Hello, ${user.username}!`;
  }


  if (user.role === "student") {

    byId("teacherDashboard")
      ?.classList.add("hidden");

    byId("studentDashboard")
      ?.classList.remove("hidden");

  } else {

    byId("studentDashboard")
      ?.classList.add("hidden");

    byId("teacherDashboard")
      ?.classList.remove("hidden");

  }


  if (byId("topAvatar")) {
    loadDashboardAvatar(user);
  }

}


async function loadDashboardAvatar(user) {

  try {

    const response =
      await fetch(
        `${API}/profile.php?user_id=${encodeURIComponent(
          user.id
        )}`
      );


    const data =
      await response.json();


    if (
      data.success &&
      byId("topAvatar")
    ) {

      byId("topAvatar").src =
        data.user.profile_picture ||
        defaultAvatar;


      if (byId("greeting")) {

        byId("greeting").textContent =
          `Hello, ${
            data.user.name ||
            user.username
          }!`;

      }

    }

  } catch (error) {

    console.error(error);

  }

}


/* =========================================================
   EXAMS
========================================================= */

function initExams(user) {

  const teacher =
    user.role === "teacher";


  byId("teacherExamSection")
    ?.classList.toggle(
      "hidden",
      !teacher
    );


  byId("studentExamSection")
    ?.classList.toggle(
      "hidden",
      teacher
    );


  if (byId("examPageTitle")) {

    byId("examPageTitle").textContent =
      teacher ? "Create Exam" : "Exams";

  }


  if (byId("examListTitle")) {

    byId("examListTitle").textContent =
      teacher
        ? "Created Exams"
        : "Available Exams";

  }


  if (teacher) {

    questionCount = 0;


    if (byId("questionList")) {
      byId("questionList").innerHTML = "";
    }


    addQuestion();


    if (byId("addQuestion")) {
      byId("addQuestion").onclick =
        () => addQuestion();
    }


    if (byId("examForm")) {

      byId("examForm").onsubmit =
        event =>
          publishExam(
            event,
            user
          );

    }


    renderExamList(user);

  } else {

    if (byId("takeExamForm")) {

      byId("takeExamForm").onsubmit =
        event => {

          event.preventDefault();

          startExam(
            user,
            byId("takeExamId")
              ?.value
              .trim()
          );

        };

    }


    renderExamList(user);

  }

}


/* =========================================================
   QUESTION BUILDER
========================================================= */

function refreshQuestionCount() {

  const count =
    document.querySelectorAll(
      ".question-card"
    ).length;


  const label =
    byId("questionCount");


  if (label) {

    label.textContent =
      `${count} ${
        count === 1
          ? "Question"
          : "Questions"
      }`;

  }

}


function addQuestion(afterCard = null) {

  questionCount =
    document.querySelectorAll(
      ".question-card"
    ).length + 1;


  const number = questionCount;


  const card =
    document.createElement("div");


  card.className =
    "question-card";


  card.dataset.q = number;


  card.innerHTML = `

    <div class="question-head">

      <div class="question-number">

        <span class="q-number-badge">
          ${number}
        </span>

        <span class="question-head-title">
          Question ${number}
        </span>

      </div>

      <button
        type="button"
        class="danger-btn remove-question"
      >
        Remove
      </button>

    </div>

    <label>

      Question Text

      <textarea
        class="q-text"
        rows="3"
        required
        placeholder="Type your question here..."
      ></textarea>

    </label>

    <label>

      Question Type

      <select class="q-type">

        <option value="mcq">
          Multiple Choice
        </option>

        <option value="tf">
          True or False
        </option>

        <option value="essay">
          Essay
        </option>

      </select>

    </label>

    <div class="choice-area">

      ${getMCQHTML()}

    </div>

    <div class="question-actions">

      <button
        type="button"
        class="add-after-btn"
      >
        + Add Question After This
      </button>

    </div>

  `;


  if (
    afterCard &&
    afterCard.parentElement
  ) {

    afterCard.parentElement.insertBefore(
      card,
      afterCard.nextSibling
    );

  } else {

    byId("questionList")
      ?.appendChild(card);

  }


  const type =
    card.querySelector(".q-type");


  const area =
    card.querySelector(".choice-area");


  type.onchange = () => {

    if (type.value === "mcq") {

      area.innerHTML =
        getMCQHTML();

    } else if (type.value === "tf") {

      area.innerHTML = `

        <label>

          Correct Answer

          <select class="correct">

            <option>True</option>

            <option>False</option>

          </select>

        </label>

      `;

    } else {

      area.innerHTML = `

        <p class="muted small">

          Essay answers will be checked
          and scored by the teacher
          after submission.

        </p>

      `;

    }

  };


  card.querySelector(
    ".remove-question"
  ).onclick = () => {

    card.remove();
    renumberQuestions();

  };


  card.querySelector(
    ".add-after-btn"
  ).onclick = () => {

    addQuestion(card);
    renumberQuestions();

  };


  refreshQuestionCount();

}


function getMCQHTML() {

  return `

    <div class="choice-grid">

      <label>

        A

        <input
          class="choice"
          placeholder="Option A"
          required
        >

      </label>

      <label>

        B

        <input
          class="choice"
          placeholder="Option B"
          required
        >

      </label>

      <label>

        C

        <input
          class="choice"
          placeholder="Option C"
          required
        >

      </label>

      <label>

        D

        <input
          class="choice"
          placeholder="Option D"
          required
        >

      </label>

    </div>

    <label>

      Correct Answer

      <select class="correct">

        <option>A</option>

        <option>B</option>

        <option>C</option>

        <option>D</option>

      </select>

    </label>

  `;

}


function renumberQuestions() {

  document
    .querySelectorAll(".question-card")
    .forEach(
      (card, index) => {

        const number = index + 1;


        card.dataset.q = number;


        const badge =
          card.querySelector(
            ".q-number-badge"
          );


        const title =
          card.querySelector(
            ".question-head-title"
          );


        if (badge) {
          badge.textContent = number;
        }


        if (title) {
          title.textContent =
            `Question ${number}`;
        }

      }
    );


  questionCount =
    document.querySelectorAll(
      ".question-card"
    ).length;


  refreshQuestionCount();

}


/* =========================================================
   LOAD EXAMS FROM MYSQL
========================================================= */

async function getExamsFromDatabase(user) {

  const url =
    `${API}/exams.php?role=${
      encodeURIComponent(user.role)
    }&user_id=${
      encodeURIComponent(user.id)
    }`;


  const response =
    await fetch(url);


  const data =
    await response.json();


  if (!data.success) {

    throw new Error(
      data.message ||
        "Failed to load exams."
    );

  }


  return (
    data.exams || []
  ).map(
    exam => {

      return {

        id:
          String(
            exam.examCode
          ),

        databaseId:
          Number(
            exam.id
          ),

        title:
          exam.title,

        teacher:
          exam.teacher || "",

        teacherId:
          Number(
            exam.teacherId || 0
          ),

        deadline:
          exam.deadline,

        duration:
          Number(
            exam.duration
          ) || 30,

        createdAt:
          exam.createdAt,

        questions:
          (
            exam.questions || []
          ).map(
            question => {

              return {

                id:
                  Number(
                    question.id
                  ),

                text:
                  question.text || "",

                type:
                  normalizeQuestionType(
                    question.type
                  ),

                choices:
                  question.choices || [],

                answer:
                  question.answer ??
                  null

              };

            }
          )

      };

    }
  );

}


/* =========================================================
   PUBLISH EXAM
========================================================= */

async function publishExam(
  event,
  user
) {

  event.preventDefault();


  const id =
    byId("examId")
      ?.value
      .trim();


  const title =
    byId("examTitle")
      ?.value
      .trim();


  const deadline =
    byId("examDeadline")
      ?.value;


  const duration =
    Number(
      byId("examDuration")
        ?.value
    );


  if (!id) {

    return message(
      "examMessage",
      "Please enter an Exam ID.",
      true
    );

  }


  if (!title) {

    return message(
      "examMessage",
      "Please enter an exam title.",
      true
    );

  }


  if (!deadline) {

    return message(
      "examMessage",
      "Please select a deadline.",
      true
    );

  }


  if (!duration || duration <= 0) {

    return message(
      "examMessage",
      "Please enter a valid duration.",
      true
    );

  }


  const cards = [
    ...document.querySelectorAll(
      ".question-card"
    )
  ];


  if (!cards.length) {

    return message(
      "examMessage",
      "Add at least one question.",
      true
    );

  }


  const questions = [];


  for (const card of cards) {

    const type =
      card.querySelector(
        ".q-type"
      )?.value || "mcq";


    const text =
      card.querySelector(
        ".q-text"
      )?.value
      .trim() || "";


    if (!text) {

      return message(
        "examMessage",
        "Every question needs question text.",
        true
      );

    }


    let choices = [];
    let answer = null;


    if (type === "mcq") {

      choices =
        [
          ...card.querySelectorAll(
            ".choice"
          )
        ].map(
          input =>
            input.value.trim()
        );


      if (choices.length !== 4) {

        return message(
          "examMessage",
          "Each multiple-choice question needs 4 choices.",
          true
        );

      }


      if (
        choices.some(
          choice => !choice
        )
      ) {

        return message(
          "examMessage",
          "Please complete all choices.",
          true
        );

      }


      const selected =
        card.querySelector(
          ".correct"
        )?.value || "";


      const index =
        [
          "A",
          "B",
          "C",
          "D"
        ].indexOf(selected);


      if (index < 0) {

        return message(
          "examMessage",
          "Please select a correct answer.",
          true
        );

      }


      answer = choices[index];

    }


    else if (type === "tf") {

      answer =
        card.querySelector(
          ".correct"
        )?.value || "";


      if (
        answer !== "True" &&
        answer !== "False"
      ) {

        return message(
          "examMessage",
          "Please select True or False.",
          true
        );

      }

    }


    questions.push({

      text,

      type:
        mysqlQuestionType(type),

      choices,

      answer

    });

  }


  const mysqlDeadline =
    toMySQLDateTime(deadline);


  const form =
    byId("examForm");


  const submitButton =
    form?.querySelector(
      'button[type="submit"]'
    );


  if (submitButton) {

    submitButton.disabled = true;
    submitButton.textContent =
      "Publishing...";

  }


  try {

    const response =
      await fetch(
        `${API}/exams.php`,
        {

          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({

              action: "create",

              teacher_id:
                Number(user.id),

              exam_code: id,

              title,

              deadline:
                mysqlDeadline,

              duration,

              questions

            })

        }
      );


    const data =
      await response.json();


    if (!data.success) {

      return message(
        "examMessage",
        data.message ||
          "Failed to publish exam.",
        true
      );

    }


    message(
      "examMessage",
      `Exam published successfully! Exam ID: ${id}`
    );


    byId("examForm")?.reset();


    if (byId("questionList")) {
      byId("questionList").innerHTML = "";
    }


    questionCount = 0;

    addQuestion();


    await renderExamList(user);


  } catch (error) {

    console.error(error);


    message(
      "examMessage",
      "Unable to connect to the server.",
      true
    );

  } finally {

    if (submitButton) {

      submitButton.disabled = false;
      submitButton.textContent =
        "Publish Exam";

    }

  }

}


/* =========================================================
   EXAM LIST
========================================================= */

async function renderExamList(user) {

  const list =
    byId("examList");


  if (!list) return;


  list.innerHTML = `
    <p class="muted">
      Loading exams...
    </p>
  `;


  try {

    const exams =
      await getExamsFromDatabase(user);


    if (!exams.length) {

      list.innerHTML = `

        <p class="muted">

          ${
            user.role === "teacher"
              ? "You have not created any exams yet."
              : "No exams available."
          }

        </p>

      `;

      return;

    }


    list.innerHTML =
      exams.map(
        exam => `

          <div class="exam-row">

            <div>

              <b>
                ${esc(exam.title)}
              </b>

              <div class="small muted">

                ID:
                ${esc(exam.id)}

                ·

                ${exam.questions.length}
                question(s)

                · Deadline:
                ${fmtDate(exam.deadline)}

              </div>

            </div>


            ${
              user.role === "student"

                ? `

                  <button
                    class="btn secondary quick-take"
                    data-id="${esc(exam.id)}"
                    type="button"
                  >

                    Take Exam

                  </button>

                `

                : `

                  <a
                    class="btn secondary"
                    href="results.html?exam=${encodeURIComponent(
                      exam.databaseId
                    )}"
                  >

                    Responses

                  </a>

                `
            }

          </div>

        `
      ).join("");


    document
      .querySelectorAll(".quick-take")
      .forEach(button => {

        button.onclick =
          () => {

            startExam(
              user,
              button.dataset.id
            );

          };

      });


  } catch (error) {

    console.error(error);


    list.innerHTML = `

      <p class="muted">

        Unable to load exams from the database.

      </p>

    `;

  }

}


/* =========================================================
   START EXAM
========================================================= */

async function startExam(
  user,
  id
) {

  if (!id) {

    return message(
      "takeMessage",
      "Please enter an Exam ID.",
      true
    );

  }


  try {

    const exams =
      await getExamsFromDatabase(user);


    const exam =
      exams.find(
        item =>
          item.id.toLowerCase() ===
          String(id).toLowerCase()
      );


    if (!exam) {

      return message(
        "takeMessage",
        "Exam ID not found.",
        true
      );

    }


    const deadline =
      parseDate(exam.deadline);


    if (
      deadline &&
      deadline <= new Date()
    ) {

      return message(
        "takeMessage",
        "This exam is already past its deadline.",
        true
      );

    }


    currentExam = exam;


    byId("takingSection")
      ?.classList.remove("hidden");


    if (byId("takingTitle")) {

      byId("takingTitle").textContent =
        exam.title;

    }


    if (byId("takingMeta")) {

      byId("takingMeta").textContent =
        `Teacher: ${
          exam.teacher || "—"
        } · ID: ${
          exam.id
        } · ${
          exam.duration
        } minutes`;

    }


    if (byId("takingQuestions")) {

      byId("takingQuestions").innerHTML =
        exam.questions
          .map(
            (
              question,
              index
            ) =>
              renderTakingQuestion(
                question,
                index
              )
          )
          .join("");

    }


    const duration =
      Number(exam.duration) > 0
        ? Number(exam.duration)
        : 30;


    const endTime =
      Date.now() +
      duration * 60000;


    clearInterval(examInterval);


    examInterval =
      setInterval(
        () => {

          const left =
            Math.max(
              0,
              endTime - Date.now()
            );


          const seconds =
            Math.floor(
              left / 1000
            );


          if (byId("examTimer")) {

            byId("examTimer").textContent =
              `${String(
                Math.floor(seconds / 60)
              ).padStart(
                2,
                "0"
              )}:${String(
                seconds % 60
              ).padStart(
                2,
                "0"
              )}`;

          }


          if (!left) {

            clearInterval(examInterval);

            byId("takingForm")
              ?.requestSubmit();

          }

        },
        250
      );


    const takingForm =
      byId("takingForm");


    if (takingForm) {

      takingForm.onsubmit =
        event => {

          event.preventDefault();


          submitExamToDatabase(
            user,
            exam,
            new FormData(event.target)
          );

        };

    }


    byId("takingSection")
      ?.scrollIntoView({
        behavior: "smooth"
      });


  } catch (error) {

    console.error(error);


    message(
      "takeMessage",
      "Unable to load the exam from the database.",
      true
    );

  }

}


/* =========================================================
   RENDER TAKING QUESTION
========================================================= */

function renderTakingQuestion(
  question,
  index
) {

  let input = "";


  if (question.type === "essay") {

    input = `

      <textarea
        name="q_${question.id}"
        rows="5"
        placeholder="Type your answer..."
      ></textarea>

    `;

  }


  else if (question.type === "tf") {

    input = `

      <div class="answer-option">

        <label>

          <input
            type="radio"
            name="q_${question.id}"
            value="True"
            required
          >

          True

        </label>

      </div>

      <div class="answer-option">

        <label>

          <input
            type="radio"
            name="q_${question.id}"
            value="False"
          >

          False

        </label>

      </div>

    `;

  }


  else {

    input =
      question.choices
        .map(
          choice => `

            <div class="answer-option">

              <label>

                <input
                  type="radio"
                  name="q_${question.id}"
                  value="${esc(choice)}"
                  required
                >

                ${esc(choice)}

              </label>

            </div>

          `
        )
        .join("");

  }


  return `

    <div class="question-card">

      <h3>

        ${index + 1}.
        ${esc(question.text)}

      </h3>

      ${input}

    </div>

  `;

}


/* =========================================================
   SUBMIT EXAM TO MYSQL
========================================================= */

async function submitExamToDatabase(
  user,
  exam,
  formData
) {

  clearInterval(examInterval);


  const takingForm =
    byId("takingForm");


  const submitButton =
    takingForm?.querySelector(
      'button[type="submit"]'
    );


  if (submitButton) {

    submitButton.disabled = true;
    submitButton.textContent =
      "Submitting...";

  }


  /*
   * IMPORTANT:
   * submissions.php expects an ARRAY:
   *
   * answers: [
   *   {
   *     question_id: 1,
   *     answer: "Answer"
   *   }
   * ]
   */

  const answers = [];


  exam.questions.forEach(question => {

    const value =
      formData.get(
        `q_${question.id}`
      );


    answers.push({

      question_id:
        Number(question.id),

      answer:
        value !== null
          ? String(value)
          : ""

    });

  });


  try {

    const response =
      await fetch(
        `${API}/submissions.php`,
        {

          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({

              action: "submit",

              student_id:
                Number(user.id),

              exam_id:
                Number(exam.databaseId),

              answers

            })

        }
      );


    const data =
      await response.json();


    console.log(
      "SUBMISSION RESPONSE:",
      data
    );


    if (!data.success) {

      throw new Error(
        data.message ||
          "Failed to submit exam."
      );

    }


    currentExam = null;


    byId("takingSection")
      ?.classList.add("hidden");


    alert(
      "Exam submitted successfully!"
    );


    location.href =
      "results.html";


  } catch (error) {

    console.error(
      "SUBMISSION ERROR:",
      error
    );


    alert(
      "Failed to submit exam.\n\n" +
      error.message
    );


    if (submitButton) {

      submitButton.disabled = false;
      submitButton.textContent =
        "Submit Exam";

    }

  }

}


/* =========================================================
   RESULTS INITIALIZATION
========================================================= */

function initResults(user) {

  const teacherResults =
    byId("teacherResults");


  const studentResults =
    byId("studentResults");


  if (
    !teacherResults ||
    !studentResults
  ) {
    return;
  }


  if (user.role === "student") {

    teacherResults.classList.add(
      "hidden"
    );

    studentResults.classList.remove(
      "hidden"
    );


    if (byId("resultsEyebrow")) {

      byId("resultsEyebrow").textContent =
        "EXAM HISTORY";

    }


    if (byId("resultsPageTitle")) {

      byId("resultsPageTitle").textContent =
        "My Results";

    }


    if (byId("resultsPageSubtitle")) {

      byId("resultsPageSubtitle").textContent =
        "View your submitted exams and released scores.";

    }


    if (byId("headerRole")) {

      byId("headerRole").textContent =
        "Student";

    }


    renderStudentResults(user);

    return;

  }


  studentResults.classList.add(
    "hidden"
  );


  teacherResults.classList.remove(
    "hidden"
  );


  if (byId("resultsEyebrow")) {

    byId("resultsEyebrow").textContent =
      "RESULTS & RESPONSES";

  }


  if (byId("resultsPageTitle")) {

    byId("resultsPageTitle").textContent =
      "Student Responses";

  }


  if (byId("resultsPageSubtitle")) {

    byId("resultsPageSubtitle").textContent =
      "Check student answers, update scores, and release results.";

  }


  if (byId("headerRole")) {

    byId("headerRole").textContent =
      "Teacher";

  }


  renderTeacherResults(user);

}


/* =========================================================
   GET STUDENT SUBMISSIONS
========================================================= */

async function getStudentSubmissions(user) {

  const response =
    await fetch(
      `${API}/submissions.php?role=student&student_id=${encodeURIComponent(
        user.id
      )}`
    );


  const data =
    await response.json();


  if (!data.success) {

    throw new Error(
      data.message ||
        "Unable to load student submissions."
    );

  }


  return Array.isArray(data.data)
    ? data.data
    : [];

}


/* =========================================================
   GET TEACHER SUBMISSIONS
========================================================= */

async function getTeacherSubmissions(user) {

  const response =
    await fetch(
      `${API}/submissions.php?role=teacher&teacher_id=${encodeURIComponent(
        user.id
      )}`
    );


  const data =
    await response.json();


  if (!data.success) {

    throw new Error(
      data.message ||
        "Unable to load teacher submissions."
    );

  }


  return Array.isArray(data.data)
    ? data.data
    : [];

}


/* =========================================================
   STUDENT RESULTS
========================================================= */

async function renderStudentResults(user) {

  const list =
    byId("studentResultList");


  if (!list) return;


  list.innerHTML = `

    <p class="muted">
      Loading results...
    </p>

  `;


  try {

    const submissions =
      await getStudentSubmissions(user);


    if (!submissions.length) {

      list.innerHTML = `

        <div class="results-empty">

          <div class="results-empty-icon">
            ◇
          </div>

          <h3>
            No exam results yet
          </h3>

          <p>
            Once you take an exam,
            your submission will appear here.
          </p>

        </div>

      `;

      return;

    }


    list.innerHTML =
      submissions
        .map(submission => {

          const released =
            Number(
              submission.released
            ) === 1;


          const score =
            submission.score !== null &&
            submission.score !== undefined
              ? submission.score
              : null;


          const scoreText =
            score !== null
              ? `${score} point(s)`
              : "Pending";


          const statusText =
            released
              ? `Released · Score: ${scoreText}`
              : "Waiting for teacher";


          const statusClass =
            released
              ? "released"
              : "pending";


          return `

            <div class="student-result-item">

              <div class="student-result-main">

                <div class="result-exam-icon">
                  □
                </div>

                <div>

                  <h3>
                    ${esc(
                      submission.title
                    )}
                  </h3>

                  <p>

                    ID:
                    ${esc(
                      submission.exam_code
                    )}

                    · Submitted:
                    ${fmtDate(
                      submission.submitted_at
                    )}

                  </p>

                </div>

              </div>


              <div class="student-result-right">

                <span
                  class="status-pill ${statusClass}"
                >

                  ${statusText}

                </span>


                <button
                  class="btn secondary student-view-result"
                  data-id="${submission.id}"
                  type="button"
                >

                  View Result

                </button>

              </div>

            </div>

          `;

        })
        .join("");


    document
      .querySelectorAll(
        ".student-view-result"
      )
      .forEach(button => {

        button.onclick =
          () => {

            showStudentDetail(
              user,
              button.dataset.id
            );

          };

      });


  } catch (error) {

    console.error(error);


    list.innerHTML = `

      <p class="muted">

        Unable to load results from the database.

      </p>

    `;

  }

}


/* =========================================================
   STUDENT RESULT DETAIL
========================================================= */

async function showStudentDetail(
  user,
  submissionId
) {

  const box =
    byId("resultDetail");


  if (!box) return;


  box.classList.remove("hidden");


  box.innerHTML = `

    <p class="muted">
      Loading result...
    </p>

  `;


  try {

    const submissions =
      await getStudentSubmissions(user);


    const submission =
      submissions.find(
        item =>
          String(
            item.submission_id
          ) ===
          String(submissionId)
      );


    if (!submission) {

      throw new Error(
        "Result not found."
      );

    }


    const released =
      Number(
        submission.released
      ) === 1;


    const score =
      submission.score !== null &&
      submission.score !== undefined
        ? submission.score
        : null;


    const questions =
      submission.questions || [];


    const answers =
      submission.answers || [];


    const answerMap = {};


    answers.forEach(answer => {

      answerMap[
        Number(answer.question_id)
      ] =
        answer.answer ?? "";

    });


    box.innerHTML = `

      <div class="result-detail-header">

        <div>

          <span class="eyebrow">

            ${
              released
                ? "RELEASED RESULT"
                : "SUBMISSION"
            }

          </span>


          <h2>

            ${esc(
              submission.title
            )}

          </h2>


          <p>

            Submitted:
            ${fmtDate(
              submission.submitted_at
            )}

          </p>

        </div>


        <div class="result-score-box">

          <span>

            ${
              released
                ? "Final Score"
                : "Status"
            }

          </span>


          <strong>

            ${
              released
                ? `${score ?? 0} point(s)`
                : "Pending"
            }

          </strong>

        </div>

      </div>


      ${
        released

          ? `

            <div class="student-final-result">

              <span>
                FINAL SCORE
              </span>

              <strong>
                ${score ?? 0}
              </strong>

              <small>
                Your teacher has released this result.
              </small>

            </div>

          `

          : `

            <div class="result-pending-message">

              <strong>
                Your result is being reviewed.
              </strong>

              <p>
                Check back later once your teacher
                has released the final score.
              </p>

            </div>

          `
      }


      ${
        released && questions.length

          ? `

            <div
              class="student-answer-review"
              style="padding:20px;"
            >

              <h3>
                Answer Review
              </h3>

              ${questions
                .map(
                  (question, index) => {

                    const answer =
                      answerMap[
                        Number(question.id)
                      ] ?? "";


                    return `

                      <div
                        class="response-question"
                        style="
                          margin-bottom:20px;
                        "
                      >

                        <span class="question-number">

                          Question ${index + 1}

                        </span>


                        <h4>

                          ${esc(
                            question.question_text
                          )}

                        </h4>


                        <div class="answer-box">

                          <span class="answer-label">

                            Your Answer

                          </span>

                          <p class="student-answer">

                            ${
                              answer
                                ? esc(answer)
                                : "No Answer"
                            }

                          </p>

                        </div>


                        ${
                          question.question_type !==
                          "essay"

                            ? `

                              <div class="answer-box">

                                <span class="answer-label">

                                  Correct Answer

                                </span>

                                <p class="correct-answer">

                                  ${esc(
                                    question.correct_answer ||
                                    "—"
                                  )}

                                </p>

                              </div>

                            `

                            : ""

                        }

                      </div>

                    `;

                  }
                )
                .join("")}

            </div>

          `

          : ""

      }


      <div
        style="
          padding:20px;
          text-align:right;
        "
      >

        <button
          class="btn secondary"
          type="button"
          id="closeStudentResult"
        >

          Close

        </button>

      </div>

    `;


    byId("closeStudentResult").onclick =
      () => {

        box.classList.add("hidden");

      };


  } catch (error) {

    console.error(error);


    box.innerHTML = `

      <p class="muted">

        Unable to load this result.

      </p>


      <div
        style="
          padding:20px;
          text-align:right;
        "
      >

        <button
          class="btn secondary"
          type="button"
          id="closeStudentResultError"
        >

          Close

        </button>

      </div>

    `;


    byId("closeStudentResultError").onclick =
      () => {

        box.classList.add("hidden");

      };

  }

}


/* =========================================================
   TEACHER RESULTS
========================================================= */

async function renderTeacherResults(user) {

  const container =
    byId("teacherResultList");


  if (!container) return;


  container.innerHTML = `

    <p class="muted">
      Loading student responses...
    </p>

  `;


  try {

    const submissions =
      await getTeacherSubmissions(user);


    /*
     * Group submissions by exam.
     */

    const examGroups = {};


    submissions.forEach(submission => {

      const examId =
        Number(submission.exam_id);


      if (!examGroups[examId]) {

        examGroups[examId] = {

          id: examId,

          examCode:
            submission.exam_code,

          title:
            submission.title,

          submissions: []

        };

      }


      examGroups[examId]
        .submissions
        .push(submission);

    });


    const exams =
      Object.values(examGroups);


    /*
     * Also get teacher's exams so exams with
     * zero submissions can still appear.
     */

    let teacherExams = [];


    try {

      teacherExams =
        await getExamsFromDatabase(user);

    } catch (error) {

      console.warn(
        "Could not load teacher exams:",
        error
      );

    }


    teacherExams.forEach(exam => {

      const examId =
        Number(exam.databaseId);


      if (!examGroups[examId]) {

        examGroups[examId] = {

          id: examId,

          examCode:
            exam.id,

          title:
            exam.title,

          submissions: []

        };

      }

    });


    const allExams =
      Object.values(examGroups);


    if (!allExams.length) {

      container.innerHTML = `

        <p class="muted">

          You have not created any exams yet.

        </p>

      `;

      return;

    }


    container.innerHTML =
      allExams
        .map(exam => {

          const scores =
            exam.submissions
              .filter(
                submission =>
                  submission.score !== null
              )
              .map(
                submission =>
                  Number(
                    submission.score
                  )
              );


          const average =
            scores.length
              ? (
                  scores.reduce(
                    (a, b) => a + b,
                    0
                  ) /
                  scores.length
                ).toFixed(2)
              : null;


          return `

            <div class="exam-result-group">

              <div class="exam-result-title">

                <div>

                  <h3>

                    ${esc(
                      exam.title
                    )}

                  </h3>

                  <p>

                    ID:
                    ${esc(
                      exam.examCode
                    )}

                    · Submissions:
                    ${exam.submissions.length}

                    ${
                      average !== null
                        ? ` · Average:
                            ${average} point(s)`
                        : ""
                    }

                  </p>

                </div>


                <button
                  class="btn secondary teacher-view-exam"
                  type="button"
                  data-exam-id="${exam.id}"
                >

                  View Responses

                </button>

              </div>

            </div>

          `;

        })
        .join("");


    document
      .querySelectorAll(
        ".teacher-view-exam"
      )
      .forEach(button => {

        button.onclick =
          () => {

            showTeacherExamResponses(
              user,
              button.dataset.examId
            );

          };

      });


    const params =
      new URLSearchParams(
        location.search
      );


    const examId =
      params.get("exam");


    if (examId) {

      await showTeacherExamResponses(
        user,
        examId
      );

    }


  } catch (error) {

    console.error(error);


    container.innerHTML = `

      <p class="muted">

        Unable to load student responses.

      </p>

    `;

  }

}


/* =========================================================
   TEACHER EXAM RESPONSES
========================================================= */

async function showTeacherExamResponses(
  user,
  examId
) {

  const container =
    byId("teacherResultList");


  if (!container) return;


  try {

    const submissions =
      await getTeacherSubmissions(user);


    const examSubmissions =
      submissions.filter(
        submission =>
          String(
            submission.exam_id
          ) ===
          String(examId)
      );


    /*
     * If there are submissions, use the first
     * one to get exam information.
     */

    let exam = null;


    if (examSubmissions.length) {

      exam = {

        id:
          Number(examId),

        title:
          examSubmissions[0].title,

        examCode:
          examSubmissions[0].exam_code

      };

    } else {

      /*
       * If no submissions exist, load the
       * teacher's exams.
       */

      const exams =
        await getExamsFromDatabase(user);


      const found =
        exams.find(
          item =>
            Number(
              item.databaseId
            ) ===
            Number(examId)
        );


      if (found) {

        exam = {

          id:
            found.databaseId,

          title:
            found.title,

          examCode:
            found.id

        };

      }

    }


    if (!exam) {

      throw new Error(
        "Exam not found."
      );

    }


    container.innerHTML = `

      <div
        style="
          margin-bottom:20px;
        "
      >

        <button
          type="button"
          class="btn secondary"
          id="backToAllResults"
        >

          ← Back to All Exams

        </button>

      </div>


      <div class="exam-result-group">

        <div class="exam-result-title">

          <div>

            <h3>

              ${esc(exam.title)}

            </h3>

            <p>

              ID:
              ${esc(exam.examCode)}

              ·
              ${examSubmissions.length}
              submission(s)

            </p>

          </div>

        </div>


        <div class="responses-label">

          Student Submissions
          (${examSubmissions.length})

        </div>


        ${
          examSubmissions.length

            ? examSubmissions
                .map(
                  submission => `

                    <div class="student-response">

                      <div class="student-info">

                        <div class="student-avatar">

                          ${esc(
                            (
                              submission.student_name ||
                              submission.student_username ||
                              "S"
                            )
                              .charAt(0)
                              .toUpperCase()
                          )}

                        </div>


                        <div>

                          <h4>

                            ${esc(
                              submission.student_name ||
                              submission.student_username ||
                              "Student"
                            )}

                          </h4>


                          <p>

                            Submitted:
                            ${fmtDate(
                              submission.submitted_at
                            )}

                          </p>

                        </div>

                      </div>


                      <div
                        style="
                          display:flex;
                          align-items:center;
                          gap:12px;
                        "
                      >

                        <span
                          class="response-status ${
                            Number(
                              submission.released
                            ) === 1
                              ? "released"
                              : "pending"
                          }"
                        >

                          ${
                            Number(
                              submission.released
                            ) === 1

                              ? `Released (${submission.score ?? 0} point(s))`

                              : "Pending Review"
                          }

                        </span>


                        <button
                          class="view-result-btn teacher-grade-btn"
                          type="button"
                          data-submission-id="${submission.id}"
                        >

                          Grade / Review

                        </button>

                      </div>

                    </div>

                  `
                )
                .join("")

            : `

              <p
                class="muted"
                style="
                  padding:15px 20px;
                "
              >

                No submissions received yet.

              </p>

            `
        }

      </div>

    `;


    byId("backToAllResults").onclick =
      () => {

        history.pushState(
          {},
          "",
          "results.html"
        );

        renderTeacherResults(user);

      };


    document
      .querySelectorAll(
        ".teacher-grade-btn"
      )
      .forEach(button => {

        button.onclick =
          () => {

            showTeacherGradeDetail(
              user,
              button.dataset.submissionId,
              exam.id
            );

          };

      });


  } catch (error) {

    console.error(error);


    container.innerHTML = `

      <p class="muted">

        Unable to load student responses.

      </p>

    `;

  }

}


/* =========================================================
   TEACHER GRADING DETAIL
========================================================= */

async function showTeacherGradeDetail(
  user,
  submissionId,
  examId
) {

  const box =
    byId("resultDetail");


  if (!box) return;


  box.classList.remove("hidden");


  box.innerHTML = `

    <p class="muted">
      Loading submission...
    </p>

  `;


  try {

    const submissions =
      await getTeacherSubmissions(user);


    const submission =
      submissions.find(
        item =>
          String(
            item.submission_id
          ) ===
          String(submissionId)
      );


    if (!submission) {

      throw new Error(
        "Submission not found."
      );

    }


    const questions =
      submission.questions || [];


    const answers =
      submission.answers || [];


    const answerMap = {};


    answers.forEach(answer => {

      answerMap[
        Number(answer.question_id)
      ] =
        answer.answer ?? "";

    });


    box.innerHTML = `

      <div class="result-detail-header">

        <div>

          <span class="eyebrow">
            REVIEW SUBMISSION
          </span>


          <h2>

            ${esc(
              submission.title
            )}

          </h2>


          <div class="student-detail-info">

            <div class="student-detail-avatar">

              ${esc(
                (
                  submission.student_name ||
                  submission.student_username ||
                  "S"
                )
                  .charAt(0)
                  .toUpperCase()
              )}

            </div>


            <div>

              <strong>

                ${esc(
                  submission.student_name ||
                  submission.student_username ||
                  "Student"
                )}

              </strong>


              <span>

                Submitted:
                ${fmtDate(
                  submission.submitted_at
                )}

              </span>

            </div>

          </div>

        </div>


        <button
          class="close-result-btn"
          type="button"
          id="closeGradeDetail"
        >

          Close

        </button>

      </div>


      <form
        id="gradingForm"
        class="response-review"
      >

        ${
          questions.length

            ? questions
                .map(
                  (
                    question,
                    index
                  ) => {

                    const answer =
                      answerMap[
                        Number(question.id)
                      ] ?? "";


                    const isEssay =
                      question.question_type ===
                      "essay";


                    return `

                      <div class="response-question">

                        <span class="question-number">

                          Question ${index + 1}

                          ${
                            isEssay
                              ? "(Essay)"
                              : ""
                          }

                        </span>


                        <h4>

                          ${esc(
                            question.question_text
                          )}

                        </h4>


                        <div class="answer-box">

                          <span class="answer-label">

                            Student's Answer

                          </span>


                          <p class="student-answer">

                            ${
                              answer
                                ? esc(answer)
                                : "No Answer"
                            }

                          </p>

                        </div>


                        ${
                          !isEssay

                            ? `

                              <div class="answer-box">

                                <span class="answer-label">

                                  Correct Answer

                                </span>


                                <p class="correct-answer">

                                  ${esc(
                                    question.correct_answer ||
                                    "—"
                                  )}

                                </p>

                              </div>

                            `

                            : `

                              <div class="essay-score-area">

                                <label>

                                  Essay Score

                                  <input
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="1"
                                    name="essay_${question.id}"
                                    value="0"
                                  >

                                </label>

                              </div>

                            `

                        }

                      </div>

                    `;

                  }
                )
                .join("")

            : `

              <p class="muted">

                No answers found.

              </p>

            `
        }


        <div
          style="
            margin-top:20px;
            display:flex;
            gap:10px;
            justify-content:flex-end;
          "
        >

          <button
            type="button"
            class="close-result-btn"
            id="cancelGrade"
          >

            Cancel

          </button>


          <button
            type="submit"
            class="btn primary"
          >

            Release Score

          </button>

        </div>

      </form>

    `;


    byId("closeGradeDetail").onclick =
      () => {

        box.classList.add("hidden");

      };


    byId("cancelGrade").onclick =
      () => {

        box.classList.add("hidden");

      };


    const gradingForm =
      byId("gradingForm");


    if (!gradingForm) return;


    gradingForm.onsubmit =
      async event => {

        event.preventDefault();


        const submitButton =
          gradingForm.querySelector(
            'button[type="submit"]'
          );


        if (submitButton) {

          submitButton.disabled = true;

          submitButton.textContent =
            "Releasing...";

        }


        /*
         * Build essay scores in the exact
         * format expected by submissions.php.
         */

        const essayScores = [];


        questions.forEach(question => {

          if (
            question.question_type !==
            "essay"
          ) {
            return;
          }


          const input =
            gradingForm.querySelector(
              `[name="essay_${question.id}"]`
            );


          let score =
            Number(
              input?.value || 0
            );


          if (score < 0) {
            score = 0;
          }


          if (score > 1) {
            score = 1;
          }


          essayScores.push({

            question_id:
              Number(question.id),

            score

          });

        });


        try {

          const response =
            await fetch(
              `${API}/submissions.php`,
              {

                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify({

                    action: "release",

                    teacher_id:
                      Number(user.id),

                    submission_id:
                      Number(submissionId),

                    essay_scores:
                      essayScores

                  })

              }
            );


          const data =
            await response.json();


          console.log(
            "RELEASE RESPONSE:",
            data
          );


          if (!data.success) {

            throw new Error(
              data.message ||
                "Failed to release result."
            );

          }


          alert(
            "Result released successfully!"
          );


          box.classList.add("hidden");


          /*
           * Refresh teacher results.
           */

          if (
            new URLSearchParams(
              location.search
            ).get("exam")
          ) {

            await showTeacherExamResponses(
              user,
              examId
            );

          } else {

            await renderTeacherResults(
              user
            );

          }


        } catch (error) {

          console.error(
            "RELEASE ERROR:",
            error
          );


          alert(
            "Failed to release result.\n\n" +
            error.message
          );


          if (submitButton) {

            submitButton.disabled = false;

            submitButton.textContent =
              "Release Score";

          }

        }

      };

  } catch (error) {

    console.error(error);


    box.innerHTML = `

      <p class="muted">

        Unable to load this submission.

      </p>


      <div
        style="
          padding:20px;
          text-align:right;
        "
      >

        <button
          class="btn secondary"
          type="button"
          id="closeGradeError"
        >

          Close

        </button>

      </div>

    `;


    byId("closeGradeError").onclick =
      () => {

        box.classList.add("hidden");

      };

  }

}