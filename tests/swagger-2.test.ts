import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as yaml from 'js-yaml';
import * as prettier from 'prettier';
import swaggerToTS from '../src';
import { Swagger2 } from '../src/swagger-2';

// Let Prettier handle formatting, not the test expectations
function format(spec: string, namespaced?: boolean) {
  const wrapped = namespaced === false ? spec : `namespace OpenAPI2 { ${spec} }`;
  return prettier.format(wrapped, { parser: 'typescript' });
}

describe('Swagger 2 spec', () => {
  describe('core Swagger types', () => {
    it('string -> string', () => {
      const swagger: Swagger2 = {
        definitions: {
          User: {
            properties: {
              email: { type: 'string' },
            },
            type: 'object',
          },
        },
      };

      const ts = format(`
      export interface User {
        email?: string;
      }`);

      expect(swaggerToTS(swagger)).toBe(ts);
    });

    it('integer -> number', () => {
      const swagger: Swagger2 = {
        definitions: {
          User: {
            properties: {
              age: { type: 'integer' },
            },
            type: 'object',
          },
        },
      };

      const ts = format(`
      export interface User {
        age?: number;
      }`);

      expect(swaggerToTS(swagger)).toBe(ts);
    });

    it('number -> number', () => {
      const swagger: Swagger2 = {
        definitions: {
          User: {
            properties: {
              lat: { type: 'number', format: 'float' },
            },
            type: 'object',
          },
        },
      };

      const ts = format(`
      export interface User {
        lat?: number;
      }`);

      expect(swaggerToTS(swagger)).toBe(ts);
    });

    it('boolean -> boolean', () => {
      const swagger: Swagger2 = {
        definitions: {
          User: {
            properties: {
              active: { type: 'boolean' },
            },
            type: 'object',
          },
        },
      };

      const ts = format(`
      export interface User {
        active?: boolean;
      }`);

      expect(swaggerToTS(swagger)).toBe(ts);
    });
  });

  describe('complex structures', () => {
    it('handles arrays of primitive structures', () => {
      const swagger: Swagger2 = {
        definitions: {
          User: {
            properties: {
              teams: { type: 'array', items: { type: 'string' } },
            },
            type: 'object',
          },
        },
      };

      const ts = format(`
      export interface User {
        teams?: string[];
      }`);

      expect(swaggerToTS(swagger)).toBe(ts);
    });

    it('handles arrays of complex items', () => {
      const swagger: Swagger2 = {
        definitions: {
          Team: {
            properties: {
              id: { type: 'string' },
            },
            type: 'object',
          },
          User: {
            properties: {
              teams: { type: 'array', items: { $ref: '#/definitions/Team' } },
            },
            type: 'object',
          },
        },
      };

      const ts = format(`
      export interface User {
        teams?: Team[];
      }
      export interface Team {
        id?: string;
      }`);

      expect(swaggerToTS(swagger)).toBe(ts);
    });

    it('handles allOf', () => {
      const swagger: Swagger2 = {
        definitions: {
          Admin: {
            allOf: [
              { $ref: '#/definitions/User' },
              {
                properties: {
                  rbac: { type: 'string' },
                },
                type: 'object',
              },
            ],
            type: 'object',
          },
          User: {
            properties: {
              email: { type: 'string' },
            },
            type: 'object',
          },
        },
      };

      const ts = format(`
      export interface User {
        email?: string;
      }
      export interface Admin extends User {
        rbac?: string;
      }`);

      expect(swaggerToTS(swagger)).toBe(ts);
    });

    it('handles oneOf', () => {
      const swagger: Swagger2 = {
        definitions: {
          Record: {
            properties: {
              rand: {
                oneOf: [{ type: 'string' }, { type: 'number' }],
                type: 'array',
              },
            },
            type: 'object',
          },
        },
      };

      const ts = format(`
      export interface Record {
        rand?: string | number;
      }`);

      expect(swaggerToTS(swagger)).toBe(ts);
    });
  });

  describe('TS features', () => {
    it('specifies required types', () => {
      const swagger: Swagger2 = {
        definitions: {
          User: {
            properties: {
              username: { type: 'string' },
            },
            required: ['username'],
            type: 'object',
          },
        },
      };

      const ts = format(`
      export interface User {
        username: string;
      }`);

      expect(swaggerToTS(swagger)).toBe(ts);
    });

    it('flattens single-type $refs', () => {
      const swagger: Swagger2 = {
        definitions: {
          User: {
            properties: {
              password: { $ref: '#/definitions/UserPassword' },
            },
            type: 'object',
          },
          UserPassword: {
            type: 'string',
          },
        },
      };

      const ts = format(`
      export interface User {
        password?: string;
      }`);

      expect(swaggerToTS(swagger)).toBe(ts);
    });
  });

  describe('other output', () => {
    it('generates the example output correctly', () => {
      const input = yaml.safeLoad(
        readFileSync(resolve(__dirname, '..', 'example', 'input.yaml'), 'UTF-8')
      );
      const output = readFileSync(resolve(__dirname, '..', 'example', 'output.ts'), 'UTF-8');

      expect(swaggerToTS(input)).toBe(format(output, false));
    });
  });
});