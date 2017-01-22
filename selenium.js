var selenium = require('selenium-standalone');
var extend = require('extend');

var selenium_options = {
  // check for more recent versions of selenium here:
  // https://selenium-release.storage.googleapis.com/index.html
  //version: '2.45.0',
  baseURL: 'https://selenium-release.storage.googleapis.com',
  drivers: {
    chrome: {
      // check for more recent versions of chrome driver here:
      // https://chromedriver.storage.googleapis.com/index.html
      //version: '2.15',
      arch: process.arch,
      baseURL: 'https://chromedriver.storage.googleapis.com'
    },
    phantomjs: {
      binary: {
        path:'./node_modules/phantomjs-prebuilt/bin/phantomjs'
      }
    }
  },
  //proxy: 'http://localproxy.com', // see https://github.com/request/request#proxies
  spawnOptions: {
  //    stdio: 'inherit'
  }
}

const install = ()=> new Promise((resolve, reject) => {
      console.log('installing');
      selenium.install(extend(selenium_options, {
        progressCb: function(totalLength, progressLength, chunkLength) {
          console.log(progressLength/totalLength*100);
        }
      }), function (err) {
        if(err){
          reject(err);
        }
        console.log('install complete');
        resolve();
      });
});


const startclient = () => new Promise(
    (resolve, reject)=>{
      console.log('starting selenium');
      selenium.start(extend(selenium_options, {

      }), (error, child)=> {

        if(error){
          reject(error);
          return;
        }
        console.log('selenium started');
        resolve(child);
      });

    }
  );

var webdriver = {
  start: ()=> {
    return install().then(
      startclient
    );
  }
}


module.exports = exports = webdriver;
