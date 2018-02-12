/**
 * 这里的主要作用，是将 dva 风格的 reducer 和 state 转化成 redux 本来接受的那种方式
 * 个人感觉，不得不说，虽然这个文件代码不多，但是代码精炼，值得学习
 * **/
function identify(value) {
  return value;
}

function handleAction(actionType, reducer = identify) {
  return (state, action) => { // 经过转化之后的reducer
    const { type } = action;
    if (type && actionType !== type) {
      return state;
    }
    return reducer(state, action); // 虽然这个时候还是接收两个参数，但是 action.type 实际上不会再用到了
  };
}

function reduceReducers(...reducers) {
  return (previous, current) => // previous: 上次的 current: 这次的，也就是带有 payload 的action
    reducers.reduce( // 一个一个处理
      (p, r) => r(p, current),
      previous,
    );
}

function handleActions(handlers, defaultState) { // handlers 实际上就是传入的纯函数 reducers
  const reducers = Object.keys(handlers).map(type => handleAction(type, handlers[type]));
  // 经过转化之后，这里的 reducer 应该是 reducers 数组(就是我们平时直接用 redux 写的那种)
  const reducer = reduceReducers(...reducers);
  return (state = defaultState, action) => reducer(state, action);
}

export default handleActions;
