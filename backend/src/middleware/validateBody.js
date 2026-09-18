import HTTP_STATUS from '../constants/httpStatus.js';

/**
 * Validation — step 4 of the chain in .claude/backend-rules.md.
 *
 * Replaces `req.body` with the parsed result, so a handler downstream can only
 * ever see fields the schema named. That substitution is the point: validating
 * without replacing leaves the raw body in place for the next careless `$set`.
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      // Field paths only. Values can carry case content, and a 400 body is not
      // the place for it.
      const fields = result.error.issues.map((issue) =>
        issue.path.length ? issue.path.join('.') : '(root)',
      );
      return next(
        Object.assign(new Error('Request body failed validation'), {
          status: HTTP_STATUS.BAD_REQUEST,
          details: { fields: [...new Set(fields)] },
        }),
      );
    }

    req.body = result.data;
    return next();
  };
}

export default validateBody;
