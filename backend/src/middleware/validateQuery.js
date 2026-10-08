import HTTP_STATUS from '../constants/httpStatus.js';

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
