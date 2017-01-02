module.exports = exports = {
  // The absolute url to the website you want to unleash the monkey on goes here
  url: 'your absolute url goes here  like http://google.com/',
  // This is the port for the proxy the monkey sets up to search for 404 and
  // 500 requests
  proxy_port: 9034,
  // The intro is played everytime to monkey restarts.
  // This enables you to for example login incase the monkey is working on
  // a site that requires login.
  //
  // The intro is played on a webdriverio driver, and has to return a promise.
  // The promise returned can be the result of the webdriver as it returns
  // promises.
  intro: (driver)=>
      driver.pause(1000).setValue('#user', 'Admin').pause(100).
      setValue('#password', 'Admin').pause(100).click('#loginButton').pause(100),
  // The fence is a set of options to keep the monkey constrained to your site
  // Or to parts of the site.
  // The black list is used to for example detect if the monkey has managed to
  // log it self out. Or if you have other pages that once reached the
  // monkey should restart.
  // The path setting requires the monkey to have that string in the path its
  // running on.
  //
  // If any of the fence settings is reached, the monkey will restart by going
  // to the url specified and
  fence: {
    //blacklist: ['#/login'],
    //path: 'path of app to constrain clickmonkey too'
  }
};
