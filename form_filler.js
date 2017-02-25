var chance = require('chance')();
// TODO: Fill in forms with bad input
// TODO: Fill in forms SQL injection
// TODO: Fill in forms HTML and CSS injection
// TODO: Fill in forms javascript injection
// TODO: clear the form instead.

function fill_input(element) {
  switch (element.type) {
    case 'text':
      if(chance[element.id || element.form_name]){
        //console.log('filling with', element.id || element.form_name);
        return element.set_value(chance[element.id || element.form_name]())
      }
      return element.set_value(chance.sentence({words: chance.natural({min:0, max: 13})}).replace('.',''));
    case 'textarea':
      return element.set_value(chance.paragraph());
    case 'email':
      return element.set_value(chance.email({domain: "example.com"}));
    case 'number':
      return element.set_value(''+chance.natural());
    case 'select-one':
      //console.log('selecting index');
      return element.select_index(chance.natural({min:0, max: element.options.length}));
    case 'date':
      return element.set_value(''+chance.date());
    case 'datetime':
      return element.set_value(''+chance.date());
    case 'checkbox':
      return element.set_value(''+chance.bool());
    default:
      return element.set_value(chance.sentence());
  }
}



module.exports = exports = {
  fill_form: (form)=>Promise.all(form.elements.map(fill_input)).then(()=>{
      //console.log('forms sumbitted', forms++);
      return form.submit();
    }),
  fill_input: fill_input
};
