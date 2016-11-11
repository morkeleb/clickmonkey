const program = require('commander');
const path = require('path');
const fs = require('fs');

program.parse(process.argv);

var file_path;
var file = program.args[0];
if(file){
  file_path = path.join(path.dirname(fs.realpathSync(__filename)), file);
}

file_path = file_path || 'clickmonkey.js';

if(fs.existsSync(file_path)){
  console.log('monkey settings already exists: ', file_path);
  return
}

console.log('writing example monkey settings to: ', file_path);
fs.createReadStream('example_settings.js').pipe(fs.createWriteStream(file_path));
