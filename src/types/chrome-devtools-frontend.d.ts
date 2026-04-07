// 空类型声明用于绕过 chrome-devtools-frontend 类型检查
declare module 'chrome-devtools-frontend/**/*' {
  const _default: any;
  export default _default;
}
