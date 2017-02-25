function getRandomInt(max) {
    return Math.floor(Math.random() * (max));
}

var form_filler = require('./form_filler');

// TODO: Log elements clicked along with url before and after ! BLOCKED !
// TODO: Log 404 and 500
// TODO: Detect JS errors

module.exports = exports = (arguments)=>{
  const proxy = arguments[0]; // used to pickup 404, 500 and loading
  const browser = arguments[1];
  const options = arguments[2];

  const check_fence = ()=> new Promise((resolve, reject)=> browser.get_url().then((url)=>{
      //console.log('currently at: ', url);
      if(url.indexOf(options.proxyUrl) == -1){
        console.log('left proxy. Restarting...');
        return proxy.reset_errors().then(browser.restart).then(proxy.wait_for_load).then(resolve); // we left the proxied domain

      }
      if(options.fence && options.fence.blacklist) {
        if(options.fence.blacklist.filter(bl=>url.indexOf(bl) != -1).length > 0){
          console.log('Reached blacklist page. Restarting...');
          return proxy.reset_errors().then(browser.restart).then(proxy.wait_for_load).then(resolve);
        }
      }
      if(options.fence && options.fence.path) {
        if(url.indexOf(options.fence.path) == -1 ){
          console.log('Left path fence. Restarting...');
          return proxy.reset_errors().then(browser.restart).then(proxy.wait_for_load).then(resolve);
        }
      }
      resolve();
    }));

  const check_load_errors = ()=> new Promise((resolve, reject)=>{
    proxy.get_errors().then((errors)=>{
      if(errors.length == 0){
        return Promise.resolve();
      }
      console.log(errors); // TODO: implement real logging
      return browser.restart()
    }).then(proxy.reset_errors).then(resolve, reject)
  });

  const decide_action = () => {
    switch (getRandomInt(6)) {
      case 1:
        return browser.get_forms().
        then(forms=>{
          if(forms.length == 0) {
            return Promise.resolve();
          }
          return form_filler.fill_form(forms[getRandomInt(forms.length)]);
        });
      case 2:
        return browser.get_inputs().then(
          inputs=>{
            if(inputs.lenth == 0){
              return Promise.resolve();
            }
            return form_filler.fill_input(inputs[getRandomInt(inputs.length)])
          }
        )
      default:
        return browser.get_clickable_elements().
          then(e=>browser.click(e[getRandomInt(e.length)]));
    }

  };

  var p = Promise.resolve(1);
  for (var i = 0; i < 10000; i++) {
    p = p.then(proxy.wait_for_load).then(check_fence).then(decide_action);
  }
  return p;
}
