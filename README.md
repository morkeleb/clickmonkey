# ClickMonkey!


Click Monkey is a self contained testing tool that will stress your webbased ui
with random clicks and input.
Typically Click Monkey will find errors related to input validation.

Click Monkey works just like a selenium test, except it never stops.
It simply keeps clicking random elements and inputing random data until you stop it.

To help the monkey find errors such as 500 and 404 status codes it will setup a
local proxy to see the browsers errors and report if it finds any broken urls.

## Getting started!

Requirements:

* JRE
* Node 6.3+

To install your clickmonkey you use npm.

```bash
npm install -G clickmonkey
```

Your clickmonkey needs a configuration file to point it to the right website.
To setup a configuration file you type

```bash
clickmonkey init
```

This will create a file `clickmonkey.js` for you to configure.
You can specify a specific filename if you do not like the `clickmonkey.js`.
This also allows you to have several configurations stored on disc.

The configuration file should be self-explanatory, but here are the essentials.

### Url

Your configuration file must specify the url where the monkey will be unleashed.

```javascript
  // The absolute url to the website you want to unleash the monkey on goes here
  url: 'your absolute url goes here  like http://google.com/'
```

### Intro
Most pages worth testing requires a bit of wiggeling to get the monkey in the mood.

To do this you specify the `intro` in the configuration file.

```javascript
intro: (driver)=>
    driver.pause(1000).setValue('#user', 'Admin').pause(100).
    setValue('#password', 'Admin').pause(100).click('#loginButton').pause(100),
```

This intro waits a bit, enters a value into the `#user` field, then enters
another value into the `#password` field to then click hte `#loginButton`.

It is important that the intro returns the driver promise so that the monkey
can be unleashed once the intro is complete.

### Fence
To contain the monkey to certain parts of your website you can specify a fence.
To define your fence you edit the fence part of the configuration

```javascript
  fence: {
    blacklist: ['#/login'],
    path: 'path of app to constrain clickmonkey too'
  }
```

The `blacklist` should be an array of pages the monkey should leave if it reaches.
The example above has a login page as a blacklist to capture when the monkey
accedentilly logged itself out.

You can also specify a `path` in which you want to contain the monkey.

If the monkey goes outside it's fence, it will restart and go through the intro again.


### Unleashing the monkey!

To let loose your monkey you run the unleash command. This is also the default,
so you just have to type clickmonkey if you also use the default configuration file name.

```
clickmonkey
```

You can give an additional input to the clickmonkey if you want to run a different configuration file.


```
clickmonkey [configuration file]
```

or

```
clickmonkey unleash [configuration file]
```

The monkey will then:
1. install selenium with the neccessary drivers.
2. Start up a local proxy
3. Open a browser with traffic going through said proxy
4. Run the intro
5. Start click and inputing random stuff


## Lisence

MIT

## Contributing

If you want to help out, thats great! Here are some guidelines:

* Less is more
  - I suspect that I've added more code than neccessary. The goal is to have
    as litle code as possible, but yet have it be readable.

    I've missed some places where I wrap a promise in another promise for example
    where the wrapping could just be removed.

    Let's help eachother become better developers by trying to reduce and clarify
    the code.
* Pull requests are fun
  - Please issue pull requests! Just remember the guideline above.

    You should expect discussions in the pull requests.
    This is a learning experience, and is a vital part of getting a pull request accepted.
* Promises
  - The code uses promises extensivly, please respect that by doing so in issued pull requests.
* The Monkey shouldn't stop
  - It can pause for a while, and then continue, but it shouldn't stop.

    If you find a place where it stops I appreciate a heads up, or even better one of them pull requests that fixes things.
