var httpProxy = require('http-proxy');
const url = require('url');

module.exports = exports = (options) => new Promise((resolve, reject)=>{

  var requests = [];
  var errors = [];
  const requestStarted = (proxyRes, req, res) => {
    if(req.url == '/favicon.ico') return;
    requests.push(req);
  }
  const requestFinished = (proxyRes, req, res) => {
    if(res.statusCode == 500 || res.statusCode == 404){
      errors.push({
        type: 'HTTPError',
        url: req.url,
        statusCode: res.statusCode,
        body: res.body
      });
      console.log({
        type: 'HTTPError',
        url: req.url,
        statusCode: res.statusCode,
        body: res.body
      });
    }
    requests.pop();
  }
  const requestError = (err, req, res) => {
    errors.push({
      type: 'ProxyError',
      url: req.url,
      statusCode: res && res.statusCode || -1,
      body: err
    });
    console.error(err);
  };


  // TODO: We need a black list of urls not to wait for.
  const check_requests = (callback) => {
    return function() {
      if(requests.length == 0){
      //  console.log('done waiting for load');
        callback();
      } else {
        console.log('waiting for ', requests.map(r=>r.url));
        setTimeout(check_requests(callback), 500);
      }
    }
  }

  const wait_for_load = () => {
    if(requests.length == 0){
      return Promise.resolve(1);
    } else {
      console.log('waiting for load');
      return new Promise((resolve,reject)=>{
        setTimeout(check_requests(resolve), 500);
        setTimeout(resolve, 30000); // we only wait for 30 seconds, because sometimes it seems we miss requests.
      });
    }
  }

  const get_errors = ()=> new Promise((resolve,reject)=>resolve(errors));
  const reset_errors = ()=> new Promise((resolve,reject)=>{
    errors = [];
    requests = [];
    resolve();
  });

  console.log('starting proxy for: ' + options.url + ' on port: '+options.localProxy);

  const url_object = url.parse(options.url);
  var proxy = httpProxy.createProxyServer({
    target: url_object.protocol + '//' + url_object.host + '/',
    autoRewrite: true,
    hostRewrite: true,
    //toProxy: true,
    //xfwd: true,
    changeOrigin: true,
    //ignorePath: true
  }).listen(options.localProxy);

  proxy.wait_for_load = wait_for_load;
  proxy.get_errors = get_errors;
  proxy.reset_errors = reset_errors;
  proxy.on('proxyRes', requestFinished); // important to have finished before started.
  proxy.on('error', requestError);
  proxy.on('proxyReq', requestStarted);

  console.log('proxy running');
  resolve(proxy);
});
