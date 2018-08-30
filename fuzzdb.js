const download = require('download-git-repo');
const types = ['attack', 'wordlists-misc','wordlists-user-passwd'];
const exclude = ['README.md'];
const fs = require('fs');

function getRandomInt(max) {
    return Math.floor(Math.random() * (max));
}

function filter_excludes(item) {
  exclude.forEach(function (exclude) {
    if(item.indexOf(exclude)!==-1){
      return false;
    }
  });
  return true;
}
function get_string(dir) {
  fs.statSync(dir)
}

function get_random_fuzz_string() {
  console.log('getting random string');
  var type = './fuzzdb/'+types[getRandomInt(2)];
  var dir = fs.readdirSync().filter(filter_excludes);
  get_string(type+'/'+dir);

}

fuzzdb = {
  install: ()=>new Promise((resolve, reject)=>{
    if(fs.existsSync('fuzzdb')){
      resolve();
      return;
    }
    console.log('downloading fuzzdb');
      download('fuzzdb-project/fuzzdb', 'fuzzdb', (err)=>{
        console.log('download complete', err);
        if (err) return reject(err);
        resolve();
    });
  }),
  get_random_fuzz_string: get_random_fuzz_string
};


module.exports = exports = fuzzdb;
