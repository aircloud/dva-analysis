import invariant from 'invariant';
import { isPlainObject } from './utils';

const hooks = [
  'onError',
  'onStateChange',
  'onAction',
  'onHmr',
  'onReducer',
  'onEffect',
  'extraReducers',
  'extraEnhancers',
];

export function filterHooks(obj) { // 这个时候先对 obj 进行清理，清理出在我们定义的类型之外的 hooks
  return Object.keys(obj).reduce((memo, key) => {
    if (hooks.indexOf(key) > -1) {
      memo[key] = obj[key];
    }
    return memo;
  }, {});
}

export default class Plugin {
  constructor() {
    this.hooks = hooks.reduce((memo, key) => {
      memo[key] = [];
      return memo;
    }, {});
    /**
     *
     * 经过以上函数，this.hooks变成：
     * { onError: [],
         onStateChange: [],
         onAction: [],
         onHmr: [],
         onReducer: [],
         onEffect: [],
         extraReducers: [],
         extraEnhancers: []
       }
     *
     * **/
  }

  use(plugin) {
    invariant(isPlainObject(plugin), 'plugin.use: plugin should be plain object');
    const hooks = this.hooks;
    for (const key in plugin) {
      if (Object.prototype.hasOwnProperty.call(plugin, key)) { // 判断传入的插件对应的键名是否在列表中
        invariant(hooks[key], `plugin.use: unknown plugin property: ${key}`);
        if (key === 'extraEnhancers') {
          // extraEnhancers 指定额外的 StoreEnhancer, 参考：https://github.com/reactjs/redux/blob/master/docs/Glossary.md#store-enhancer
          hooks[key] = plugin[key];
        } else {
          hooks[key].push(plugin[key]);
        }
      }
    }
  }

  apply(key, defaultHandler) { // 一个一个的执行函数
    const hooks = this.hooks;
    const validApplyHooks = ['onError', 'onHmr'];
    invariant(validApplyHooks.indexOf(key) > -1, `plugin.apply: hook ${key} cannot be applied`); // 'onError', 'onHmr' 这两类钩子函数不应该被执行?
    const fns = hooks[key];

    return (...args) => {
      if (fns.length) {
        for (const fn of fns) {
          fn(...args);
        }
      } else if (defaultHandler) {
        defaultHandler(...args);
      }
    };
  }

  get(key) {
    const hooks = this.hooks;
    invariant(key in hooks, `plugin.get: hook ${key} cannot be got`);
    if (key === 'extraReducers') {
      return getExtraReducers(hooks[key]);
    } else if (key === 'onReducer') { // onReducer 和 extraReducers 两个函数也比较特殊
      return getOnReducer(hooks[key]);
    } else {
      return hooks[key];
    }
  }
}

function getExtraReducers(hook) {
  let ret = {};
  for (const reducerObj of hook) {
    ret = { ...ret, ...reducerObj };
  }
  return ret;
}

function getOnReducer(hook) {
  return function (reducer) {
    for (const reducerEnhancer of hook) {
      reducer = reducerEnhancer(reducer);
    }
    return reducer;
  };
}
