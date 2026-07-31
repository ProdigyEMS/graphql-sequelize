'use strict';

export function base64(input: string): string {
  return Buffer.from(input, 'ascii').toString('base64');
}

export function unbase64(input: string): string {
  return Buffer.from(input, 'base64').toString('ascii');
}
