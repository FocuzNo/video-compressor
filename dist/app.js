const $=s=>document.querySelector(s);
const el={input:$('#fileInput'),pick:$('#pick'),drop:$('#dropzone'),card:$('#fileCard'),thumb:$('#thumb'),name:$('#filename'),info:$('#fileinfo'),remove:$('#remove'),target:$('#target'),unit:$('#unit'),source:$('#sourceStat'),estimate:$('#resultStat'),bitrate:$('#bitrateStat'),go:$('#go'),wrap:$('#progressWrap'),text:$('#progressText'),pct:$('#progressPct'),bar:$('#bar'),error:$('#error'),result:$('#result'),resultInfo:$('#resultInfo'),download:$('#download')};
let file=null,duration=0,busy=false,worker=null,previewURL=null,resultURL=null,loadTimer=null;
const format=n=>n>=2**30?(n/2**30).toFixed(2)+' ГБ':(n/2**20).toFixed(2)+' МБ';
const bytes=()=>Number(el.target.value)*(el.unit.value==='GB'?2**30:2**20);
function error(message){el.error.textContent=message;el.error.classList.add('show')}
function update(){const target=bytes();el.estimate.textContent=target>0&&Number.isFinite(target)?'До '+format(target):'Введите размер';el.bitrate.textContent=duration?Math.floor(target*8/duration/1000*.93)+' кбит/с':'Рассчитаем автоматически';el.go.disabled=!file||busy||!Number.isFinite(target)||target<=0;el.go.textContent=busy?'Сжимаем…':file?'Сжать видео':'Сначала выберите видео';for(const x of [el.input,el.pick,el.remove,el.target,el.unit,...document.querySelectorAll('.chip[data-size]')])x.disabled=busy;}
function cleanResult(){if(resultURL)URL.revokeObjectURL(resultURL);resultURL=null;el.result.classList.remove('show');el.download.removeAttribute('href')}
function choose(f){if(!f||busy)return;if(!f.type.startsWith('video/')&&!/\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(f.name))return error('Выберите видеофайл MP4, MOV, MKV, AVI или WebM.');file=f;duration=0;cleanResult();el.error.classList.remove('show');el.wrap.classList.remove('show');if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(f);el.thumb.src=previewURL;el.name.textContent=f.name;el.info.textContent=format(f.size);el.source.textContent=format(f.size);el.card.classList.add('show');el.thumb.onloadedmetadata=()=>{if(file!==f)return;duration=Number.isFinite(el.thumb.duration)?el.thumb.duration:0;update()};el.target.value=Math.max(.01,Math.round(f.size/2**20*.5*100)/100);el.unit.value='MB';update()}
function stop(){clearTimeout(loadTimer);worker?.terminate();worker=null;busy=false;$('#cancel').hidden=true;update()}
async function compress(){
  if(!file||busy)return;const target=bytes();el.error.classList.remove('show');cleanResult();
  if(!Number.isFinite(target)||target<=0)return error('Введите положительный размер.');
  if(target>=file.size)return error('Файл уже меньше выбранного размера. Укажите размер меньше '+format(file.size)+'.');
  busy=true;update();$('#cancel').hidden=false;el.wrap.classList.add('show');el.text.textContent='Подготовка…';el.pct.textContent='0%';el.bar.style.width='0%';
  try{
    worker=new Worker('encoder.js?v=3');
    loadTimer=setTimeout(()=>{error('Не удалось загрузить видеодвижок за две минуты. Проверьте соединение и повторите.');stop()},120000);
    worker.onerror=e=>{error('Ошибка обработки: '+(e.message||'не удалось запустить видеодвижок'));stop()};
    worker.onmessage=({data:d})=>{
      if(d.type==='stage'){el.text.textContent=d.text;if(d.text!=='Загрузка видеодвижка…')clearTimeout(loadTimer)}
      if(d.type==='metadata'){duration=d.duration;update()}
      if(d.type==='progress'){el.pct.textContent=Math.round(d.value)+'%';el.bar.style.width=d.value+'%'}
      if(d.type==='error'){const memory=/memory|allocation|out of bounds/i.test(d.message);error(memory?'Браузеру не хватило памяти. Закройте лишние вкладки или уменьшите целевой размер.':(d.phase==='load'?'Не удалось загрузить видеодвижок: ':'Не удалось сжать видео: ')+d.message);el.text.textContent='Обработка остановлена';stop()}
      if(d.type==='done'){resultURL=URL.createObjectURL(d.blob);el.download.href=resultURL;el.download.download=file.name.replace(/\.[^.]+$/,'')+'-compressed.mp4';el.resultInfo.textContent=format(file.size)+' → '+format(d.blob.size)+' · меньше на '+Math.round((1-d.blob.size/file.size)*100)+'%';el.result.classList.add('show');el.text.textContent='Готово';el.pct.textContent='100%';el.bar.style.width='100%';stop()}
    };
    worker.postMessage({file,target});
  }catch(e){error('Не удалось запустить обработку: '+e.message);stop()}
}
el.pick.onclick=()=>el.input.click();el.input.onchange=()=>choose(el.input.files[0]);el.go.onclick=compress;el.remove.onclick=()=>{if(busy)return;file=null;duration=0;el.input.value='';el.card.classList.remove('show');el.wrap.classList.remove('show');el.error.classList.remove('show');el.source.textContent='—';el.thumb.removeAttribute('src');if(previewURL)URL.revokeObjectURL(previewURL);cleanResult();update()};el.target.oninput=update;el.unit.onchange=update;
document.querySelectorAll('.chip[data-size]').forEach(c=>c.onclick=()=>{el.target.value=c.dataset.size;el.unit.value='MB';update()});
for(const event of ['dragenter','dragover'])el.drop.addEventListener(event,e=>{e.preventDefault();if(!busy)el.drop.classList.add('over')});for(const event of ['dragleave','drop'])el.drop.addEventListener(event,e=>{e.preventDefault();el.drop.classList.remove('over')});el.drop.addEventListener('drop',e=>choose(e.dataTransfer.files[0]));
if(document.modelContext?.registerTool)Promise.resolve(document.modelContext.registerTool({name:'set_video_target_size',description:'Установить целевой размер выбранного видео.',inputSchema:{type:'object',properties:{size:{type:'number',exclusiveMinimum:0},unit:{type:'string',enum:['MB','GB']}},required:['size','unit'],additionalProperties:false},annotations:{readOnlyHint:false},execute(v){if(busy||!Number.isFinite(v?.size)||v.size<=0||!['MB','GB'].includes(v.unit))throw Error('Некорректный размер или обработка уже запущена');el.target.value=v.size;el.unit.value=v.unit;update();return{target_bytes:bytes()}}})).catch(()=>{});
$('#cancel').onclick=()=>{stop();el.text.textContent='Сжатие отменено'};
update();
