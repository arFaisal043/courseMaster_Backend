# CourseMaster Backend — Codebase Issues Report

**Review date:** 2026-10-24
**Scope:** Static review of the backend application, API routes, middleware, models, seed script, configuration, and README.
**Approach:** Findings below are based on source inspection; no live database or deployed service was accessed. The worktree was clean before this report was created.

## Remediation status

All 15 findings listed below have been addressed in the current code. Focused regression tests were added for the corrected authentication, enrollment, quiz-answer visibility, scoring, and seed-safety behavior. The README and `.env.example` were updated to provide safe local setup and testing instructions.

## Executive summary

The review found **8 major issues** and **7 minor issues / quality gaps**. The highest-impact risks are broken login and enrollment flows, unauthorized modification of another learner's progress, public exposure of quiz answer keys, and destructive seeding against whatever database is configured.

## Major issues

| # | Issue | Evidence | Impact |
|---|---|---|---|
| 1 | **Login compares the submitted password to the stored hash as plaintext.** Accounts are created with `bcrypt.hash`, but login uses `password === user.passwordHash` instead of a bcrypt comparison. | [auth.service.js:12-13, 35-41](src/services/auth.service.js) | Registered and seeded users cannot log in with their original passwords, blocking access to all authenticated functionality. |
| 2 | **Enrollment creation has inverted duplicate-check logic.** A user who is not enrolled gets “Already enrolled”; an existing enrollment proceeds to another insert, which conflicts with the unique `{ student, course }` index. | [enrollment.service.js:8-25](src/services/enrollment.service.js), [Enrollment.js:18-19](src/models/Enrollment.js) | New enrollments fail, while repeat enrollment attempts produce database errors instead of a clear duplicate response. |
| 3 | **Lesson completion does not verify enrollment ownership.** The service loads an enrollment solely by the supplied ID and changes its progress without comparing its `student` to the authenticated user. | [enrollment.routes.js:12-16](src/routes/enrollment.routes.js), [enrollment.controller.js:26-32](src/controllers/enrollment.controller.js), [enrollment.service.js:36-46](src/services/enrollment.service.js) | Any caller who can reach the endpoint and obtain an enrollment ID can change another student's progress. The service also does not verify that the lesson belongs to that enrollment's course. |
| 4 | **Public course responses expose quiz answer keys.** Course reads return full course documents; the lesson quiz schema contains `correctIndex`, and public course routes return the documents without removing that field. | [course.routes.js:6-7](src/routes/course.routes.js), [course.controller.js:18-22](src/controllers/course.controller.js), [course.service.js:45-48, 61-65](src/services/course.service.js), [Course.js:12-17](src/models/Course.js) | Anyone can retrieve correct answers before submitting a quiz, undermining assessment integrity. |
| 5 | **The seed command deletes all application data in its configured database.** It clears users, courses, enrollments, quiz submissions, and assignment submissions before inserting sample data; there is no environment guard or confirmation. | [seed.js:12-22](seed.js) | Running `npm run seed` against a non-disposable database causes irreversible data loss unless backups exist. |
| 6 | **The seed creates an admin with a fixed, publicly documented password.** The script always hashes `admin123`, and the README publishes the corresponding email and password. | [seed.js:25-32, 245-247](seed.js), [README.md:7-8](README.md) | If the seed is run in a reachable environment and the account remains enabled, anyone who knows the repository can attempt privileged login. The login defect currently masks this risk but should not be relied on as protection. |
| 7 | **Invalid JWTs are not rejected by the authentication middleware.** Verification errors call `next()` rather than returning 401. | [authMiddleware.js:13-20](src/middlewares/authMiddleware.js) | Protected routes execute without a verified identity. Admin middleware blocks routes requiring the admin role, but downstream handlers may still run with missing user context; this combines particularly poorly with the enrollment ownership defect above. |
| 8 | **Banned accounts are not blocked from authentication or protected routes.** The ban operation updates `isBanned`, but login and JWT middleware do not check it. | [User.js:8-11](src/models/User.js), [user.service.js:27-33](src/services/user.service.js), [auth.service.js:35-43](src/services/auth.service.js), [authMiddleware.js:13-20](src/middlewares/authMiddleware.js) | Banning a user does not revoke existing tokens or prevent new logins, so the account can continue using the API. |

## Minor issues and quality gaps

| # | Issue | Evidence | Impact |
|---|---|---|---|
| 1 | **Quiz percentages are scaled to 10 rather than 100.** | [quiz.service.js:32-34](src/services/quiz.service.js) | A perfect score is stored and returned as 10%, making quiz results and averages misleading. |
| 2 | **Progress saves are not awaited.** The handler returns the mutated enrollment before persistence is confirmed. | [enrollment.service.js:56-62](src/services/enrollment.service.js) | Clients can receive a success response even if saving later fails; write errors may go unobserved. |
| 3 | **CORS configuration disallows the API's write methods for browser preflights.** The custom header permits only GET and POST even though routes use PATCH and DELETE. | [app.js:30-34](app.js), [admin.routes.js:9-20](src/routes/admin.routes.js), [user.routes.js:8-10](src/routes/user.routes.js) | Cross-origin browser clients can fail when calling update, delete, or review endpoints. |
| 4 | **Admin registration documentation does not match the implementation.** The README describes registration using `ADMIN_REGISTRATION_KEY`, but registration never validates `adminKey`; the request schema also does not declare `role`, so the normal validated route does not pass a caller-supplied role to the service. | [README.md:48-54, 113-120, 379-390](README.md), [auth.validation.js:5-11](src/validators/auth.validation.js), [auth.service.js:8-20](src/services/auth.service.js) | The documented admin-registration flow does not work. Use a controlled admin-provisioning path and make the docs reflect the actual behavior. |
| 5 | **Admin assignment filtering is ineffective.** The controller calls `getAssignments()` without `req.query`; the service's filter uses `courseId`, but the submission model stores the reference as `course`. | [admin.controller.js:42-47](src/controllers/admin.controller.js), [admin.service.js:39-45](src/services/admin.service.js), [AssignmentSubmission.js:4-8](src/models/AssignmentSubmission.js) | A requested course filter is ignored or would query the wrong field, returning incorrect results. |
| 6 | **The backend environment example is misleading/incomplete.** `.env.example` identifies itself as frontend configuration and only contains `VITE_API_BASE_URL`, although the backend requires `MONGODB_URI` and `JWT_SECRET`; the README directs users to this file. | [.env.example:1-8](.env.example), [README.md:27-55](README.md) | New deployments may fail at startup or use incomplete configuration. |
| 7 | **No automated test suite or test script was found.** The repository contains no matching test files, and `package.json` defines only `dev`, `start`, and `seed` scripts. | [package.json:1-25](package.json) | The identified authentication, enrollment, authorization, and scoring regressions are not protected against recurrence. |

## Recommended remediation order

1. Fix authentication and account enforcement: compare password hashes correctly, reject invalid tokens, and check banned status.
2. Fix enrollment creation and scope progress updates to the authenticated enrollment owner; validate lesson membership.
3. Remove answer keys from public course responses and keep correct answers server-side for grading.
4. Add explicit safeguards to the seed command and remove or rotate fixed default credentials.
5. Correct quiz scoring and await progress persistence.
6. Align CORS, admin filtering/registration behavior, and backend environment documentation.
7. Add focused regression tests for each corrected behavior.

## Validation notes

This was a static source review, not a penetration test or live-database assessment. Remediation was validated with the repository's `npm test` suite and `git diff --check`. The seed script was not run against a database.

## Additional dependency audit note

Installing the locked dependencies surfaced **8 production dependency advisories** via `npm audit --omit=dev` (1 critical, 6 high, and 1 moderate), affecting `body-parser`, `jws`, `mongoose`, `nodemailer`, `path-to-regexp`, `proxy-addr`, `qs`, and `zod`. These were not part of the original static-review findings and were not changed here; resolving the Nodemailer advisories requires a major-version upgrade and compatibility review.
