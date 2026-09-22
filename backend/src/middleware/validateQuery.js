import HTTP_STATUS from '../constants/httpStatus.js';

/**
 * `validateBody`, for the query string.
 *
 * The parsed result goes to `req.validatedQuery`: in Express 5 `req.query` is
 * a getter and cannot be replaced, so a handler reads the validated values
 * there and never the raw ones.
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query ?? {});

    if (!result.success) {
      const fields = result.error.issues.map((issue) => (issue.path.length ? issue.path.join('.') : '(root)'));
      return next(
        Object.assign(new Error('Query string failed validation'), {
          status: HTTP_STATUS.BAD_REQUEST,
          details: { fields: [...new Set(fields)] },
        }),
      );
    }

    req.validatedQuery = result.data;
    return next();
  };
}

export default validateQuery;
