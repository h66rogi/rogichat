import assert from 'node:assert/strict';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createOpenApiDocument } from '../../dist/infrastructure/openapi/openapi.js';
// Validate real HTTP results against controller documentation, including error responses.
export function responseContract(app, config) {
  const doc = createOpenApiDocument(app, config);
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  const routes = Object.entries(doc.paths).map(([path, operations]) => ({ pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`), operations }));
  const validators = new Map();
  return (method, path, status, body) => {
    if (method === 'OPTIONS') return;
    const operation = routes.find(route => route.pattern.test(path.split('?')[0]))?.operations[method.toLowerCase()];
    assert.ok(operation, `Undocumented operation: ${method} ${path}`);
    const response = operation.responses[status];
    assert.ok(response, `Undocumented HTTP status: ${operation.operationId} ${status}`);
    const schema = response.content?.['application/json']?.schema;
    if (!schema) { assert.equal(body, undefined); return; }
    const key = `${operation.operationId}:${status}`;
    if (!validators.has(key)) validators.set(key, ajv.compile(schema));
    const validate = validators.get(key);
    assert.ok(validate(body), `${key}: ${JSON.stringify(validate.errors)}`);
  };
}
