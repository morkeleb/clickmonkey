#! /usr/bin/env node



const program = require('commander');

// TODO: Optionize
// TODO: Create setup function

const pjson = require('./package.json');

program
  .version(pjson.version)
  .command('init [config_file]', 'creates a config file template')
  .command('unleash [config_file]', 'starts the monkey.', {isDefault: true})
  .parse(process.argv);

//TODO break this apart!
