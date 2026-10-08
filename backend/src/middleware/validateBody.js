import HTTP_STATUS from '../constants/httpStatus.js';

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
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
