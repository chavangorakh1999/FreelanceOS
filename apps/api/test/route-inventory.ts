import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

export interface Route { method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string }
const VERB: Partial<Record<RequestMethod, Route['method']>> = { [RequestMethod.GET]: 'get', [RequestMethod.POST]: 'post', [RequestMethod.PUT]: 'put', [RequestMethod.PATCH]: 'patch', [RequestMethod.DELETE]: 'delete' };
const join = (...p: (string | undefined)[]) => '/' + p.filter(Boolean).map((s) => s!.replace(/^\/|\/$/g, '')).filter(Boolean).join('/');

/** Every HTTP route the application registers, read from Nest's own metadata, so a new route is never missed. */
export function inventory(app: INestApplication): Route[] {
  const out: Route[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const ctrl of mod.controllers.values()) {
      const type = ctrl.metatype as (new (...a: unknown[]) => unknown) | undefined;
      if (!type) continue;
      const base = Reflect.getMetadata(PATH_METADATA, type) as string | undefined;
      const proto = type.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (name === 'constructor' || typeof fn !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, fn) as string | string[] | undefined;
        const verb = VERB[Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod];
        if (path === undefined || !verb) continue;
        for (const p of Array.isArray(path) ? path : [path]) out.push({ method: verb, path: join(base, p) });
      }
    }
  }
  return out;
}
