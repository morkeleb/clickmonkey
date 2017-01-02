const program = require('commander');
const path = require('path');
const fs = require('fs');

program.parse(process.argv);

var example_settings = path.join(path.dirname(fs.realpathSync(__filename)), 'example_settings.js');
var file_path = program.args[0] || 'clickmonkey.js';

if(fs.existsSync(file_path)){
  console.log('monkey settings already exists: ', file_path);
  return
}

console.log('writing example monkey settings to: ', file_path);
fs.createReadStream(example_settings).pipe(fs.createWriteStream(file_path));
