// TODO: Fix select by index on select input

const combine_arrays = results=>Array.prototype.concat.apply([], results.map(r=>r.value));

module.exports = exports = (options)=>
  new Promise((resolve, reject)=>{
    const webdriverio = require('webdriverio');
    const page_error = ()=>{
      console.log('errors ',arguments);
      //todo: handle page errors;
    };

    const clicks = options.status.addItem('clicks', {
      label: 'clicks',
    });
    const urlstatus = options.status.addItem('urls', {
      custom: function () {
        return (this.value || '').replace('http://localhost:9034/','');
      }
    });
    const formsstatus = options.status.addItem('forms', {
      label: 'forms'
    });
    var driver = webdriverio.remote({
      desiredCapabilities: {
        browserName: 'chrome'
      }
    }).init().on('error', page_error).url(options.url);
    options.intro(driver).then(function () {
      resolve({
        get_clickable_elements:()=>{

          const links = (resolve, reject)=> driver.elements('a').then(resolve)
          const divs = (resolve, reject)=> driver.elements('div').then(resolve)
          const images = (resolve, reject)=> driver.elements('img').then(resolve)
          const buttons = (resolve, reject)=> driver.elements('button :enabled').then(resolve)


          return Promise.all([new Promise(links), new Promise(divs), new Promise(images), new Promise(buttons)]).then(combine_arrays);
        },
        click: element=>
           new Promise((resolve, reject)=>{
             clicks.inc();
             try{
              setTimeout(resolve, 1000); // needed since staleelementexceptions causes driver to stop
               driver.pause(50).elementIdClick(element.ELEMENT).then(resolve).catch(resolve);
             } catch(e){
               console.log(e);
               resolve();
             }

            }),
        get_url: ()=> {
          driver.getUrl().then((u)=>{urlstatus.value = u});
          return driver.getUrl();
        },
        restart: ()=>{
          console.log('restarting');
          driver.end();
          driver = webdriverio.remote({
            desiredCapabilities: {
              browserName: 'chrome'
            }
          }).init().on('error', page_error).url(options.url);
          return options.intro(driver);
        },
        get_forms: ()=> {
          const get_forms = ()=> driver.elements('form');
          const input_lookup = (input)=> Promise.all([
              driver.elementIdName(input.ELEMENT),
              driver.elementIdAttribute(input.ELEMENT,'name'),
              driver.elementIdAttribute(input.ELEMENT,'id'),
              driver.elementIdAttribute(input.ELEMENT,'type'),
              driver.elementIdElements(input.ELEMENT,'option'),
            ]).then(info=>{
              return {
                tag: info[0].value,
                form_name: info[1].value,
                id: info[2].value,
                type: info[3].value || info[0].value,
                options: info[4].value,
                set_value: (value)=> new Promise((resolve,reject)=>driver.elementIdClear(input.ELEMENT).elementIdValue(input.ELEMENT, value).then(resolve,resolve).catch(resolve)),
                select_index: (index)=> Promise.resolve()// new Promise((resolve,reject)=>driver.elementIdClick(input.ELEMENT).pause(100).elementIdClick(options[4].value[index]).pause(100).then(resolve,resolve).catch(resolve)),
              };
            });
          const extract_inputs = (inputs)=>{
            if(inputs.value.length == 0) return Promise.resolve([]);
            return Promise.all(inputs.value.map(input_lookup));
          }
          const create_form_object = (form)=>{
            return Promise.all([
              driver.elementIdElements(form.ELEMENT, 'input').then(extract_inputs),
              driver.elementIdElements(form.ELEMENT, 'select').then(extract_inputs),
              driver.elementIdElements(form.ELEMENT, 'textarea').then(extract_inputs)
            ]).then(elements=>{
                return {
                  form: form,
                  submit: ()=>{
                    formsstatus.inc();
                    return driver.submit(form.ELEMENT)},
                  elements: Array.prototype.concat.apply([], elements)
                }
            });
          }

          return get_forms().then((forms)=>{
            if(forms.value.length == 0) {
              return Promise.resolve([]);
            }
            return Promise.all(forms.value.map(create_form_object))
          });
        }
      });
    });




  });
