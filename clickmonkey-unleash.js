const selenium = require('./selenium');
const browser = require('./browser');
const proxy = require('./proxy');
const brains = require('./brains');
const path = require('path');
const fs   = require('fs');
const url = require('url');
const defaults = require('./default_settings');
const extend = require('extend');
const program = require('commander');
const status = require('node-status')
console = status.console()

program.parse(process.argv);

var file_path = program.args[0] || 'clickmonkey.js';

const settings_file = require(path.join(process.cwd(), file_path));

if(!settings_file){
  console.error('No settingsfile found with the name: ', file_path || 'clickmonkey.js');
  return;
}

if(!settings_file.url){
  console.error('There was no url set in the settings file.');
  return;
}

var options = extend(defaults, settings_file);

const url_object = url.parse(options.url);
const proxy_url = 'http://localhost:'+options.proxy_port;

const start_driver = (selenium_process)=>{

    const cleanup = ()=>selenium_process.kill();

    Promise.all([proxy({
      url: url_object.protocol +'//' + url_object.host +'/',
      localProxy: options.proxy_port,
      status: status
    }),
    browser({
      url: proxy_url + url_object.path,
      intro: options.intro,
      status: status
    }), Promise.resolve({
      proxyUrl: proxy_url+'/',
      fence: options.fence,
      status: status })
    ]).then((proxy, browser, options)=>{
      console.log('starting status');

      status.start({
          interval: 200,
          pattern: '{uptime}  |  {spinner.cyan} | clicks: {clicks} | forms: {forms} | at: {urls.custom}'
      });
      console.log('creating brains');
      return brains(proxy, browser, options);
    }, cleanup).then(cleanup,cleanup);
}

selenium.start().then(start_driver).catch(function (res) {
  console.error('error: ',res);
});
