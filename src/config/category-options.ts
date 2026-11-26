/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 选项类型约束与工具分类开关定义（参考 chrome-devtools-mcp/src/config/category-options.ts）。
 */

import type {YargsOptions} from '../third_party/index.js';

import type {BrowserConfig} from './schema.js';

export interface ConfigOption extends YargsOptions {
  /** 修改配置文件后是否支持热重载生效（无需重启 daemon）。 */
  reloadable?: boolean;
  /** 对应环境变量名（若有）。 */
  envKey?: string;
  /** 对应 `BrowserConfig` 字段名（若该项同时作用于浏览器配置）。 */
  browserKey?: keyof BrowserConfig;
}

type ConfigOptionBase<TBase extends YargsOptions> = Omit<
  TBase,
  'type' | 'default' | 'choices' | 'coerce'
>;

type WithDefault<T, HasDefault extends boolean> = HasDefault extends true
  ? {default: T}
  : {default?: T};

export type ConfigOptionFor<
  T,
  TBase extends YargsOptions = YargsOptions,
  HasDefault extends boolean = true,
> = [NonNullable<T>] extends [boolean]
  ? ConfigOptionBase<TBase> & {type: 'boolean'} & WithDefault<
        boolean,
        HasDefault
      >
  : [NonNullable<T>] extends [number]
    ? ConfigOptionBase<TBase> & {
        type: 'number';
        coerce?: (arg: number | undefined) => number | undefined;
      } & WithDefault<number, HasDefault>
    : [NonNullable<T>] extends [string]
      ? string extends NonNullable<T>
        ? ConfigOptionBase<TBase> & {
            type: 'string';
            coerce?: (arg: string | undefined) => string | undefined;
          } & WithDefault<string, HasDefault>
        : ConfigOptionBase<TBase> & {
            type: 'string';
            choices: ReadonlyArray<NonNullable<T>>;
          } & WithDefault<NonNullable<T>, HasDefault>
      : [NonNullable<T>] extends [string[]]
        ? ConfigOptionBase<TBase> & {
            type: 'array';
            string: true;
            coerce?: (arg: string[] | undefined) => string[] | undefined;
          } & WithDefault<string[], HasDefault>
        : ConfigOptionBase<TBase> & {
            type: 'string';
            coerce: (arg: unknown) => T;
          };

export type ConfigOptionsFor<
  TArgs,
  TBase extends YargsOptions = YargsOptions,
> = {
  [K in keyof TArgs]-?: ConfigOptionFor<
    TArgs[K],
    TBase,
    Record<never, never> extends Pick<TArgs, K> ? false : true
  >;
};

export interface CategoryOption {
  type: 'boolean';
  describe: string;
  default?: boolean;
  defaultDescription?: string;
  hidden?: boolean;
  reloadable?: boolean;
}

export enum ConfigToolCategory {
  INPUT = 'input',
  NAVIGATION = 'navigation',
  EMULATION = 'emulation',
  PERFORMANCE = 'performance',
  NETWORK = 'network',
  NETWORK_MOCKS = 'networkMocks',
  DEBUGGING = 'debugging',
  MEMORY = 'memory',
  EXTENSIONS = 'extensions',
  EXPERIMENTAL_THIRD_PARTY = 'experimentalThirdParty',
  EXPERIMENTAL_WEBMCP = 'experimentalWebmcp',
  PWA = 'pwa',
  WEBAUTHN = 'webauthn',
}

export type CategoryFlagName<
  T extends ConfigToolCategory = ConfigToolCategory,
> = `category${Capitalize<T>}`;

export type CategoryFlags = {
  [K in ConfigToolCategory as CategoryFlagName<K>]: CategoryOption;
};

export type CategoryArguments = {
  [K in ConfigToolCategory as CategoryFlagName<K>]?: boolean;
};

interface CategoryOverride {
  describe?: string;
  hidden?: boolean;
  offByDefault?: boolean;
  reloadable?: boolean;
}

const categoryOverrides: Record<ConfigToolCategory, CategoryOverride> = {
  [ConfigToolCategory.INPUT]: {},
  [ConfigToolCategory.NAVIGATION]: {},
  [ConfigToolCategory.EMULATION]: {},
  [ConfigToolCategory.PERFORMANCE]: {},
  [ConfigToolCategory.NETWORK]: {},
  [ConfigToolCategory.NETWORK_MOCKS]: {
    describe:
      'Set to true to include network mocking tools. Changing this option requires restarting the server.',
    offByDefault: true,
    reloadable: false,
  },
  [ConfigToolCategory.DEBUGGING]: {},
  [ConfigToolCategory.MEMORY]: {
    hidden: true,
    offByDefault: true,
  },
  [ConfigToolCategory.EXTENSIONS]: {
    describe: 'Set to true to include tools related to extensions.',
    offByDefault: true,
    reloadable: false,
  },
  [ConfigToolCategory.EXPERIMENTAL_THIRD_PARTY]: {
    describe:
      'Set to true to enable third-party developer tools exposed by the inspected page itself.',
    hidden: true,
    offByDefault: true,
  },
  [ConfigToolCategory.EXPERIMENTAL_WEBMCP]: {
    hidden: true,
    offByDefault: true,
  },
  [ConfigToolCategory.PWA]: {
    describe:
      'Set to true to include tools for automating Progressive Web Apps.',
    hidden: true,
    offByDefault: true,
  },
  [ConfigToolCategory.WEBAUTHN]: {
    describe:
      'Set to true to include tools that manage virtual WebAuthn authenticators.',
    hidden: true,
    offByDefault: true,
  },
};

function createOption(category: ConfigToolCategory): CategoryOption {
  const overrides = categoryOverrides[category];
  const describe = overrides.offByDefault
    ? `Set to true to include tools related to ${category}.`
    : `Set to false to exclude tools related to ${category}.`;

  return {
    type: 'boolean',
    describe,
    reloadable: true,
    ...overrides,
    // Off-by-default categories have no default so that they stay unset unless
    // passed explicitly. This keeps them out of conflict checks and lets
    // --viaCli apply its own categoryExtensions default.
    ...(overrides.offByDefault ? {} : {default: true}),
  };
}

export function categoryToFlagName(
  category: ConfigToolCategory,
): CategoryFlagName {
  return `category${category.charAt(0).toUpperCase()}${category.slice(1)}` as CategoryFlagName;
}

export function getCategoryOptions(): CategoryFlags {
  const options = {} as CategoryFlags;
  for (const category of Object.values(ConfigToolCategory)) {
    const flagName = categoryToFlagName(category);
    options[flagName] = createOption(category);
  }
  return options;
}

export function isCategoryOffByDefault(category: ConfigToolCategory): boolean {
  const flagName = categoryToFlagName(category);
  const option = getCategoryOptions()[flagName];
  return !('default' in option) || option.default !== true;
}

export function getOffByDefaultCategories(): ConfigToolCategory[] {
  const result: ConfigToolCategory[] = [];
  for (const category of Object.values(ConfigToolCategory)) {
    if (isCategoryOffByDefault(category)) {
      result.push(category);
    }
  }
  return result;
}
