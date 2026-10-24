const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../src/models/User");
const Course = require("../src/models/Course");
const Enrollment = require("../src/models/Enrollment");
const AssignmentSubmission = require("../src/models/AssignmentSubmission");
const authService = require("../src/services/auth.service");
const authMiddleware = require("../src/middlewares/authMiddleware");
const enrollmentService = require("../src/services/enrollment.service");
const courseService = require("../src/services/course.service");
const adminService = require("../src/services/admin.service");
const { calculateQuizResult } = require("../src/services/quiz.service");
const { validateSeedConfiguration } = require("../seed");

const withEnv = (t, values) => {
  const originals = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
};

test("login verifies a bcrypt password hash and rejects a wrong password", async (t) => {
  const passwordHash = await bcrypt.hash("correct horse battery", 4);
  t.mock.method(User, "findOne", async () => ({
    _id: "64b000000000000000000001",
    name: "Test User",
    email: "test@example.com",
    passwordHash,
    role: "student",
    isBanned: false,
  }));
  withEnv(t, { JWT_SECRET: "test-only-jwt-secret" });

  const result = await authService.login({
    email: "test@example.com",
    password: "correct horse battery",
  });
  assert.equal(result.user.email, "test@example.com");
  assert.ok(result.token);
  await assert.rejects(
    authService.login({ email: "test@example.com", password: "wrong password" }),
    /Invalid email or password/
  );
});

test("registration ignores a caller-supplied role and requires the configured admin key", async (t) => {
  const createdUsers = [];
  t.mock.method(User, "findOne", async () => null);
  t.mock.method(User, "create", async (user) => {
    createdUsers.push(user);
    return { ...user, _id: `64b00000000000000000000${createdUsers.length}` };
  });
  withEnv(t, {
    JWT_SECRET: "test-only-jwt-secret",
    ADMIN_REGISTRATION_KEY: "local-test-admin-key",
  });

  await authService.register({
    name: "Student",
    email: "student@example.com",
    password: "a sufficiently long password",
    role: "admin",
  });
  await assert.rejects(
    authService.register({
      name: "Attacker",
      email: "attacker@example.com",
      password: "a sufficiently long password",
      adminKey: "incorrect-key",
    }),
    /Invalid admin registration key/
  );
  await authService.register({
    name: "Admin",
    email: "admin@example.com",
    password: "a sufficiently long password",
    adminKey: "local-test-admin-key",
  });

  assert.deepEqual(createdUsers.map((user) => user.role), ["student", "admin"]);
});

test("authentication rejects invalid tokens and uses the current unbanned database user", async (t) => {
  withEnv(t, { JWT_SECRET: "test-only-jwt-secret" });
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  let nextCalled = false;
  await authMiddleware(
    { headers: { authorization: "Bearer invalid" } },
    response,
    () => { nextCalled = true; }
  );
  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);

  t.mock.method(User, "findById", async () => ({
    _id: "64b000000000000000000001",
    role: "student",
    isBanned: false,
  }));
  const token = jwt.sign(
    { id: "64b000000000000000000001", role: "admin" },
    process.env.JWT_SECRET
  );
  const request = { headers: { authorization: `Bearer ${token}` } };
  await authMiddleware(request, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.deepEqual(request.user, { id: "64b000000000000000000001", role: "student" });
});

test("authentication rejects banned users", async (t) => {
  withEnv(t, { JWT_SECRET: "test-only-jwt-secret" });
  t.mock.method(User, "findById", async () => ({
    _id: "64b000000000000000000001",
    role: "student",
    isBanned: true,
  }));
  const response = {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
  const token = jwt.sign({ id: "64b000000000000000000001" }, process.env.JWT_SECRET);

  await authMiddleware(
    { headers: { authorization: `Bearer ${token}` } },
    response,
    () => assert.fail("Banned user must not reach the route")
  );
  assert.equal(response.statusCode, 401);
});

test("enrollment creation permits a new enrollment and rejects duplicates", async (t) => {
  let lookupCount = 0;
  t.mock.method(Course, "findById", async () => ({ _id: "course-id" }));
  t.mock.method(Enrollment, "findOne", async () =>
    lookupCount++ === 0 ? null : { _id: "existing-enrollment" }
  );
  t.mock.method(Enrollment, "create", async (enrollment) => enrollment);

  const created = await enrollmentService.enrollCourse("student-id", "course-id");
  assert.equal(created.student, "student-id");
  await assert.rejects(
    enrollmentService.enrollCourse("student-id", "course-id"),
    /Already enrolled/
  );
});

test("lesson completion checks ownership and lesson membership, then awaits saving", async (t) => {
  const savedEnrollment = {
    _id: "enrollment-id",
    student: "student-id",
    course: "course-id",
    progress: { completedLessons: [], percent: 0 },
    save: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      savedEnrollment.saved = true;
    },
  };
  t.mock.method(Enrollment, "findById", async () => savedEnrollment);
  t.mock.method(Course, "findById", async () => ({
    syllabus: [{ lessons: [{ _id: "lesson-id" }] }],
  }));

  await assert.rejects(
    enrollmentService.completeLesson("enrollment-id", "lesson-id", "other-student"),
    /Enrollment not found/
  );
  await assert.rejects(
    enrollmentService.completeLesson("enrollment-id", "other-lesson", "student-id"),
    /Lesson not found/
  );
  const result = await enrollmentService.completeLesson(
    "enrollment-id",
    "lesson-id",
    "student-id"
  );
  assert.equal(result.progress.percent, 100);
  assert.equal(result.saved, true);
});

test("public course serialization removes quiz answer keys", () => {
  const course = courseService.toPublicCourse({
    title: "Example",
    syllabus: [{
      lessons: [{
        title: "Quiz lesson",
        quiz: [{ question: "Question?", options: ["A", "B"], correctIndex: 1 }],
      }],
    }],
  });

  assert.deepEqual(course.syllabus[0].lessons[0].quiz[0], {
    question: "Question?",
    options: ["A", "B"],
  });
});

test("quiz scoring returns percentages on a 0-100 scale", () => {
  const quiz = [
    { correctIndex: 0 },
    { correctIndex: 2 },
    { correctIndex: 1 },
  ];
  assert.deepEqual(calculateQuizResult(quiz, [0, 2, 1]), {
    score: 3,
    total: 3,
    percent: 100,
  });
  assert.deepEqual(calculateQuizResult(quiz, [0, 0, 1]), {
    score: 2,
    total: 3,
    percent: 67,
  });
});

test("admin assignment filtering queries the stored course reference", async (t) => {
  let capturedFilter;
  const query = {
    populate() { return this; },
    sort: async () => [],
  };
  t.mock.method(AssignmentSubmission, "find", (filter) => {
    capturedFilter = filter;
    return query;
  });

  await adminService.getAssignments({ courseId: "course-id" });
  assert.deepEqual(capturedFilter, { course: "course-id" });
});

test("seed refuses production, unconfirmed, and non-disposable databases", (t) => {
  withEnv(t, {
    NODE_ENV: "production",
    SEED_ALLOW_RESET: "true",
    MONGODB_URI: "mongodb://127.0.0.1:27017/coursemaster_test",
  });
  assert.throws(validateSeedConfiguration, /cannot run when NODE_ENV is production/);

  process.env.NODE_ENV = "development";
  process.env.SEED_ALLOW_RESET = "false";
  assert.throws(validateSeedConfiguration, /SEED_ALLOW_RESET=true/);

  process.env.SEED_ALLOW_RESET = "true";
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/coursemaster";
  assert.throws(validateSeedConfiguration, /ending in _test or _demo/);

  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/coursemaster_test";
  process.env.SEED_ADMIN_EMAIL = "admin@example.com";
  process.env.SEED_ADMIN_PASSWORD = "local-admin-password";
  process.env.SEED_STUDENT_PASSWORD = "local-student-password";
  assert.doesNotThrow(validateSeedConfiguration);
});
