export function isFunction(arg) {
  return typeof arg === 'function';
}

export function isNumber(arg) {
  return typeof arg === 'number';
}

export function isObject(arg) {
  return (typeof arg === 'undefined' ? 'undefined' : babelHelpers.typeof(arg)) === 'object' && arg !== null;
}

export function isUndefined(arg) {
  return arg === void 0;
}