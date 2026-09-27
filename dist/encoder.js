/* Single-thread FFmpeg runs in this dedicated worker, without SharedArrayBuffer. */
const base='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
let core, logs=[], phase='load';
const send=(type,data={})=>postMessage({type,...data});
async function load(){
  send('stage',{text:'Загрузка видеодвижка…'});
  importScripts(base+'/ffmpeg-core.js');
  core=await createFFmpegCore({mainScriptUrlOrBlob:base+'/ffmpeg-core.js#'+btoa(JSON.stringify({wasmURL:base+'/ffmpeg-core.wasm'}))});
  core.setLogger(({message})=>{logs.push(message);if(logs.length>30)logs.shift()});
}
function run(args){core.setTimeout(-1);core.exec(...args);const code=core.ret;core.reset();if(code!==0)throw Error(logs.slice(-6).join('\n')||'FFmpeg exit '+code)}
self.onmessage=async({data:{file,target}})=>{
  try{
    if(!(file instanceof Blob)||!Number.isFinite(target)||target<=0)throw Error('Некорректный файл или размер.');
    await load();phase='probe';send('stage',{text:'Читаем параметры видео…'});
    // WORKERFS reads slices of the File, avoiding a full multi-GB copy into WASM memory.
    core.FS.mkdir('/source');core.FS.mount(core.FS.filesystems.WORKERFS,{blobs:[{name:'input',data:file}]},'/source');
    core.setTimeout(-1);core.ffprobe('-v','error','-show_format','-show_streams','-of','json','-o','/probe.json','/source/input');
    core.reset();
    let info;try{info=JSON.parse(core.FS.readFile('/probe.json',{encoding:'utf8'}))}catch{throw Error('Не удалось прочитать параметры видео. '+logs.slice(-3).join(' '))}
    const video=info.streams.find(s=>s.codec_type==='video');
    const duration=Number(info.format.duration||video?.duration);
    if(!video||!Number.isFinite(duration)||duration<=0)throw Error('В файле нет видеодорожки с известной длительностью.');
    send('metadata',{duration});
    const hasAudio=info.streams.some(s=>s.codec_type==='audio');
    const budget=Math.floor(target*8/duration*.93);
    const audio=hasAudio?(budget<250000?32000:budget<500000?64000:96000):0;
    let bitrate=budget-audio;
    if(bitrate<24000)throw Error('Этот размер слишком мал для всей длительности видео. Увеличьте размер результата.');
    let output;
    for(let attempt=0;attempt<3;attempt++){
      phase='encode';logs=[];send('stage',{text:attempt?'Уточняем размер результата…':'Сжимаем видео…'});
      core.setProgress(({time})=>send('progress',{value:Math.min(99,Math.max(0,time/1000000/duration*100))}));
      const height=bitrate<200000?240:bitrate<450000?360:bitrate<1000000?480:bitrate<2000000?720:1080;
      const args=['-y','-i','/source/input','-map','0:v:0','-map','0:a:0?','-sn','-dn','-vf',`scale=-2:trunc(min(ih\\,${height})/2)*2`,'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-b:v',String(bitrate),'-maxrate',String(Math.floor(bitrate*1.2)),'-bufsize',String(bitrate*2),'-threads','1'];
      if(hasAudio)args.push('-c:a','aac','-b:a',String(audio),'-ac','2');
      args.push('-movflags','+faststart','/output.mp4');run(args);
      const size=core.FS.stat('/output.mp4').size;
      if(size<=target){output=core.FS.readFile('/output.mp4');break}
      bitrate=Math.floor(bitrate*target/size*.9);core.FS.unlink('/output.mp4');
    }
    if(!output)throw Error('Не удалось уложить видео в заданный размер. Увеличьте его и повторите.');
    send('done',{blob:new Blob([output],{type:'video/mp4'}),duration});
  }catch(error){send('error',{phase,message:String(error?.message||error)})}
};
