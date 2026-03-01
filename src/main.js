import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import JSZip from 'jszip';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

const statusEl = document.querySelector('#status');
const previewEl = document.querySelector('#preview');
const buildButton = document.querySelector('#buildButton');
const videoInput = document.querySelector('#videoFile');
const chooseVideoButton = document.querySelector('#chooseVideoButton');
const dropZone = document.querySelector('#dropZone');
const uploadStage = document.querySelector('#uploadStage');
const videoStage = document.querySelector('#videoStage');
const videoPreview = document.querySelector('#videoPreview');
const videoTimeEl = document.querySelector('#videoTime');
const setStartButton = document.querySelector('#setStartButton');
const setEndButton = document.querySelector('#setEndButton');
const addRowButton = document.querySelector('#addRowButton');
const clearRowsButton = document.querySelector('#clearRowsButton');
const rowStartInput = document.querySelector('#rowStart');
const rowEndInput = document.querySelector('#rowEnd');
const rowQuestionInput = document.querySelector('#rowQuestion');
const rowAnswerInput = document.querySelector('#rowAnswer');
const toastContainer = document.querySelector('#toastContainer');

const state = {
  rows: [],
  ffmpeg: null,
  ffmpegLoaded: false,
  videoUrl: null,
  videoFile: null,
};

buildButton.addEventListener('click', onBuild);
chooseVideoButton.addEventListener('click', (event) => {
  event.stopPropagation();
  videoInput.value = '';
  videoInput.click();
});
dropZone.addEventListener('click', () => {
  videoInput.value = '';
  videoInput.click();
});
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    videoInput.value = '';
    videoInput.click();
  }
});
dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragover');
  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    return;
  }
  loadVideoFile(file);
});
videoInput.addEventListener('change', onVideoSelected);
setStartButton.addEventListener('click', () => {
  rowStartInput.value = formatSecondsInput(videoPreview.currentTime || 0);
});
setEndButton.addEventListener('click', () => {
  rowEndInput.value = formatSecondsInput(videoPreview.currentTime || 0);
});
addRowButton.addEventListener('click', onAddRow);
clearRowsButton.addEventListener('click', onClearRows);
videoPreview.addEventListener('timeupdate', () => {
  videoTimeEl.textContent = `Current time: ${formatSeconds(videoPreview.currentTime || 0)}`;
});
videoPreview.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(videoPreview.duration)) {
    setStatus(`Video loaded (${formatSeconds(videoPreview.duration)}). Mark start/end and add clips.`);
  } else {
    setStatus('Video loaded. Mark start/end and add clips.');
  }
  showToast('Video loaded.', 'success');
});
videoPreview.addEventListener('error', () => {
  state.videoFile = null;
  setMediaStage(false);
  updateBuildButtonState();
  setStatus('Could not load this video in the browser. Try MP4 (H.264/AAC).');
  showToast('Video could not be loaded. Try MP4 (H.264/AAC).', 'error', 3600);
});
renderPreview(state.rows);
updateBuildButtonState();
setMediaStage(false);

function setStatus(message) {
  statusEl.textContent = message;
}

function setMediaStage(hasVideo) {
  uploadStage?.classList.toggle('hidden', hasVideo);
  videoStage?.classList.toggle('hidden', !hasVideo);
}

function showToast(message, type = 'info', durationMs = 2400) {
  if (!toastContainer) {
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, durationMs);
}

function updateBuildButtonState() {
  const hasVideo = Boolean(state.videoFile);
  buildButton.disabled = !(hasVideo && state.rows.length > 0);
}

function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) {
    return asNumber;
  }

  const parts = raw.split(':').map((part) => part.trim());
  if (parts.some((part) => part === '' || Number.isNaN(Number(part)))) {
    return null;
  }

  const nums = parts.map(Number);
  if (nums.length === 2) {
    return nums[0] * 60 + nums[1];
  }

  if (nums.length === 3) {
    return nums[0] * 3600 + nums[1] * 60 + nums[2];
  }

  return null;
}

function formatSeconds(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(3).replace(/\.000$/, '');
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatSecondsInput(seconds) {
  return Number(Math.max(0, seconds)).toFixed(3).replace(/\.000$/, '');
}

function makeRunTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

function escapeDrawtextText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function buildClipArgs({
  inputName,
  outName,
  start,
  duration,
  stampText,
  withOverlay,
  videoCodec = 'mpeg4',
  audioCodec = 'aac',
}) {
  const args = [
    '-y',
    '-i',
    inputName,
    '-ss',
    String(start),
    '-t',
    String(duration),
  ];

  if (withOverlay) {
    args.push(
      '-vf',
      `drawtext=text='${escapeDrawtextText(stampText)}':x=10:y=h-th-10:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.55`,
    );
  }

  args.push('-c:v', videoCodec);

  if (videoCodec === 'mpeg4') {
    args.push('-q:v', '5');
  } else if (videoCodec === 'libx264') {
    args.push('-crf', '24', '-preset', 'veryfast');
  }

  args.push('-c:a', audioCodec, '-movflags', 'faststart', outName);

  return args;
}

function sanitizeFilePart(text) {
  return String(text).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'clip';
}

function escapeTsvCell(text) {
  return String(text).replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function validateRows(rows) {
  return rows.map((row, index) => {
    const start = parseTime(row.start);
    const end = parseTime(row.end);
    const question = String(row.question ?? '').trim();
    const answer = String(row.answer ?? '').trim();

    if (start === null || end === null || (!question && !answer)) {
      throw new Error(`Row ${index + 1}: missing/invalid start, end, or front/back text.`);
    }

    if (end <= start) {
      throw new Error(`Row ${index + 1}: end must be greater than start.`);
    }

    return {
      rowNumber: row.rowNumber ?? index + 1,
      start,
      end,
      question,
      answer,
    };
  });
}

function buildCardSides(row, mediaTag) {
  const question = String(row.question ?? '').trim();
  const answer = String(row.answer ?? '').trim();

  if (question) {
    const back = [answer, mediaTag].filter(Boolean).join('<br><br>');
    return {
      front: question,
      back,
    };
  }

  return {
    front: mediaTag,
    back: answer,
  };
}

function renderPreview(rows) {
  if (!rows.length) {
    previewEl.innerHTML = '<p>No clips yet. Mark start/end and click Add clip.</p>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'clip-list';

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];

    const card = document.createElement('article');
    card.className = 'clip-card';

    const title = document.createElement('strong');
    title.textContent = `Clip ${i + 1}`;
    card.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'clip-grid';

    const startLabel = document.createElement('label');
    startLabel.textContent = 'Start';
    const startInput = document.createElement('input');
    startInput.className = 'table-input';
    startInput.type = 'text';
    startInput.value = formatSecondsInput(parseTime(row.start) ?? 0);
    startInput.addEventListener('change', (event) => {
      rows[i].start = event.target.value;
    });
    startLabel.appendChild(startInput);
    grid.appendChild(startLabel);

    const endLabel = document.createElement('label');
    endLabel.textContent = 'End';
    const endInput = document.createElement('input');
    endInput.className = 'table-input';
    endInput.type = 'text';
    endInput.value = formatSecondsInput(parseTime(row.end) ?? 0);
    endInput.addEventListener('change', (event) => {
      rows[i].end = event.target.value;
    });
    endLabel.appendChild(endInput);
    grid.appendChild(endLabel);

    const questionLabel = document.createElement('label');
    questionLabel.textContent = 'Front text';
    questionLabel.className = 'wide-field';
    const questionInput = document.createElement('input');
    questionInput.className = 'table-input';
    questionInput.type = 'text';
    questionInput.value = row.question ?? '';
    questionInput.addEventListener('change', (event) => {
      rows[i].question = event.target.value;
    });
    questionLabel.appendChild(questionInput);
    grid.appendChild(questionLabel);

    const answerLabel = document.createElement('label');
    answerLabel.textContent = 'Back text';
    answerLabel.className = 'wide-field';
    const answerInput = document.createElement('input');
    answerInput.className = 'table-input';
    answerInput.type = 'text';
    answerInput.value = row.answer ?? '';
    answerInput.addEventListener('change', (event) => {
      rows[i].answer = event.target.value;
    });
    answerLabel.appendChild(answerInput);
    grid.appendChild(answerLabel);

    card.appendChild(grid);

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    const goStartButton = document.createElement('button');
    goStartButton.type = 'button';
    goStartButton.textContent = 'Go start';
    goStartButton.addEventListener('click', () => {
      const start = parseTime(rows[i].start);
      if (start === null) {
        setStatus(`Row ${i + 1}: invalid start time.`);
        return;
      }
      videoPreview.currentTime = start;
      videoPreview.play().catch(() => {});
    });

    const goEndButton = document.createElement('button');
    goEndButton.type = 'button';
    goEndButton.textContent = 'Go end';
    goEndButton.addEventListener('click', () => {
      const end = parseTime(rows[i].end);
      if (end === null) {
        setStatus(`Row ${i + 1}: invalid end time.`);
        return;
      }
      videoPreview.currentTime = end;
      videoPreview.pause();
    });

    const setStartFromPlayerButton = document.createElement('button');
    setStartFromPlayerButton.type = 'button';
    setStartFromPlayerButton.textContent = 'Start=Now';
    setStartFromPlayerButton.addEventListener('click', () => {
      rows[i].start = formatSecondsInput(videoPreview.currentTime || 0);
      renderPreview(rows);
    });

    const setEndFromPlayerButton = document.createElement('button');
    setEndFromPlayerButton.type = 'button';
    setEndFromPlayerButton.textContent = 'End=Now';
    setEndFromPlayerButton.addEventListener('click', () => {
      rows[i].end = formatSecondsInput(videoPreview.currentTime || 0);
      renderPreview(rows);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => {
      rows.splice(i, 1);
      renderPreview(rows);
      updateBuildButtonState();
    });

    actions.appendChild(goStartButton);
    actions.appendChild(goEndButton);
    actions.appendChild(setStartFromPlayerButton);
    actions.appendChild(setEndFromPlayerButton);
    actions.appendChild(deleteButton);
    card.appendChild(actions);

    list.appendChild(card);
  }

  previewEl.innerHTML = '';
  previewEl.appendChild(list);
}

function onVideoSelected() {
  const videoFile = videoInput.files?.[0];
  if (!videoFile) {
    state.videoFile = null;
    setMediaStage(false);
    updateBuildButtonState();
    return;
  }
  loadVideoFile(videoFile);
}

function loadVideoFile(videoFile) {
  if (!String(videoFile.type || '').startsWith('video/')) {
    state.videoFile = null;
    setStatus('Selected file is not a video.');
    showToast('Selected file is not a video.', 'error');
    updateBuildButtonState();
    return;
  }

  if (state.videoUrl) {
    URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = null;
  }

  videoPreview.pause();
  videoPreview.removeAttribute('src');
  videoPreview.load();

  state.videoFile = videoFile;
  state.videoUrl = URL.createObjectURL(videoFile);
  videoPreview.src = state.videoUrl;
  videoPreview.preload = 'metadata';
  videoPreview.load();
  setMediaStage(true);
  updateBuildButtonState();
  setStatus('Loading video...');
  showToast('Loading video...', 'info', 1400);
}

function onAddRow() {
  const start = parseTime(rowStartInput.value);
  const end = parseTime(rowEndInput.value);
  const question = String(rowQuestionInput.value ?? '').trim();
  const answer = String(rowAnswerInput.value ?? '').trim();

  if (start === null || end === null || (!question && !answer)) {
    setStatus('Manual row is invalid. Enter start/end and front or back text.');
    showToast('Add clip needs start/end and either front or back text.', 'error', 3200);
    return;
  }

  if (end <= start) {
    setStatus('Manual row is invalid. End must be greater than start.');
    showToast('End time must be greater than start time.', 'error');
    return;
  }

  const newRow = {
    rowNumber: state.rows.length + 1,
    start,
    end,
    question,
    answer,
  };

  state.rows.push(newRow);

  renderPreview(state.rows);
  updateBuildButtonState();
  rowQuestionInput.value = '';
  rowAnswerInput.value = '';
  rowStartInput.value = formatSecondsInput(end);
  rowEndInput.value = '';
  setStatus(`Added row ${state.rows.length}.`);
  showToast(`Clip ${state.rows.length} added.`, 'success');
}

function onClearRows() {
  state.rows = [];
  renderPreview(state.rows);
  updateBuildButtonState();
  setStatus('Cleared all rows.');
  showToast('All clips cleared.', 'info');
}

async function ensureFfmpeg() {
  if (state.ffmpegLoaded) {
    return;
  }

  setStatus('Loading FFmpeg core (~31MB). First run can take 1-2 minutes...');
  showToast('Loading FFmpeg...', 'info', 1800);
  state.ffmpeg = new FFmpeg();

  const loadWithTimeout = (promise, timeoutMs) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        window.setTimeout(() => {
          reject(new Error('FFmpeg load timed out.'));
        }, timeoutMs);
      }),
    ]);

  try {
    await loadWithTimeout(
      state.ffmpeg.load({
        coreURL,
        wasmURL,
      }),
      120000,
    );
  } catch (localError) {
    showToast('Local FFmpeg load failed, trying CDN fallback...', 'info', 2600);
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    try {
      await loadWithTimeout(
        state.ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        }),
        120000,
      );
    } catch (cdnError) {
      throw new Error(`FFmpeg failed to load. Local: ${localError.message} CDN: ${cdnError.message}`);
    }
  }

  state.ffmpegLoaded = true;
  showToast('FFmpeg ready.', 'success', 1800);
}

async function onBuild() {
  const videoFile = state.videoFile;
  if (!videoFile) {
    setStatus('Pick a video file first.');
    showToast('Pick a video file first.', 'error');
    return;
  }

  if (!state.rows.length) {
    setStatus('Add at least one clip first.');
    showToast('Add at least one clip first.', 'error');
    return;
  }

  buildButton.disabled = true;
  buildButton.classList.add('loading');
  addRowButton.disabled = true;
  clearRowsButton.disabled = true;

  try {
    showToast('Starting clip processing...', 'info', 1800);
    const rows = validateRows(state.rows);
    await ensureFfmpeg();
    const runStamp = makeRunTimestamp();

    const ffmpeg = state.ffmpeg;
    const inputExt = (videoFile.name.split('.').pop() || 'mp4').toLowerCase();
    const inputName = `input.${sanitizeFilePart(inputExt)}`;
    await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

    const zip = new JSZip();
    const mediaFolder = zip.folder('media');
    if (!mediaFolder) {
      throw new Error('Could not initialize ZIP media folder.');
    }

    const tsvLines = [
      '#separator:tab',
      '#html:true',
      '#tags column:3',
    ];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const outName = `clip_${String(i + 1).padStart(3, '0')}_${runStamp}.mp4`;
      const duration = Math.max(0.05, row.end - row.start);
      setStatus(`Rendering clip ${i + 1}/${rows.length}...`);
      showToast(`Rendering clip ${i + 1}/${rows.length}...`, 'info', 1200);

      await ffmpeg.exec(
        buildClipArgs({
          inputName,
          outName,
          start: row.start,
          duration,
          stampText: '',
          withOverlay: false,
          videoCodec: 'mpeg4',
          audioCodec: 'aac',
        }),
      );

      const outputBytes = await ffmpeg.readFile(outName);

      if (!outputBytes || outputBytes.length === 0) {
        throw new Error(`Clip ${i + 1} exported as 0 bytes. Try a longer segment or different source video.`);
      }
      const clipBlob = new Blob([outputBytes], { type: 'video/mp4' });
      const mediaTag = `[sound:${outName}]`;
      const card = buildCardSides(row, mediaTag);

      mediaFolder.file(outName, clipBlob);
      tsvLines.push(`${escapeTsvCell(card.front)}\t${escapeTsvCell(card.back)}\t`);

      await ffmpeg.deleteFile(outName);
    }

    await ffmpeg.deleteFile(inputName);

    setStatus('Building Anki import ZIP...');
    zip.file('notes.tsv', tsvLines.join('\n'));
    zip.file(
      'README_IMPORT.txt',
      [
        '1) Unzip this package.',
        '2) In Anki: File > Import > notes.tsv',
        '3) During import, map field 1 -> Front and field 2 -> Back.',
        '4) After importing notes:',
        '   To add your video clips so Anki can play them, place the physical files from media/ into your specific profile\'s collection.media folder.',
        '5) Inside Anki (All OS): Go to Tools > Check Media.',
        '6) In the dialog that pops up, click the "View Files" button at the bottom. This will open your collection.media folder immediately.',
        '7) If a row has Front text, video is placed on Back (with optional Back text).',
        '8) If a row has only Back text, video is placed on Front.',
      ].join('\n'),
    );

    const outputBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(outputBlob, 'anki_clips_import.zip');

    setStatus(`Done. Generated ${rows.length} cards and export ZIP.`);
    showToast(`Export complete: ${rows.length} clips.`, 'success', 3200);
  } catch (error) {
    setStatus(`Failed: ${error.message}`);
    showToast(`Export failed: ${error.message}`, 'error', 4200);
  } finally {
    buildButton.classList.remove('loading');
    addRowButton.disabled = false;
    clearRowsButton.disabled = false;
    updateBuildButtonState();
  }
}
