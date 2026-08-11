type AdultSex = 'female' | 'male';
type AdultPreset = 'female' | 'male' | 'athletic' | 'curvy' | 'slim' | 'natural';

const $ = <T extends HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

const presets: Record<AdultPreset, Record<string, number>> = {
  female: { shoulderScale: 94, chestScale: 102, waistScale: 86, hipScale: 108, buildScale: 96, armScale: 100, legScale: 100 },
  male: { shoulderScale: 110, chestScale: 108, waistScale: 100, hipScale: 95, buildScale: 105, armScale: 100, legScale: 100 },
  athletic: { shoulderScale: 108, chestScale: 105, waistScale: 90, hipScale: 100, buildScale: 104, armScale: 101, legScale: 102 },
  curvy: { shoulderScale: 98, chestScale: 108, waistScale: 82, hipScale: 116, buildScale: 100, armScale: 100, legScale: 101 },
  slim: { shoulderScale: 96, chestScale: 92, waistScale: 84, hipScale: 96, buildScale: 87, armScale: 100, legScale: 103 },
  natural: { shoulderScale: 100, chestScale: 100, waistScale: 100, hipScale: 100, buildScale: 100, armScale: 100, legScale: 100 },
};

function setRange(id: string, value: number): void {
  const input = $<HTMLInputElement>(`#${id}`);
  if (!input) return;
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyBuilderPreset(preset: AdultPreset): void {
  const values = presets[preset];
  Object.entries(values).forEach(([id, value]) => setRange(id, value));
  const status = $('#faceScanStatus');
  if (status) {
    const label = preset === 'female' ? 'realistic adult female' : preset === 'male' ? 'realistic adult male' : `realistic adult ${preset}`;
    status.textContent = `Body base set to ${label} proportions. You can fine-tune every measurement before building.`;
  }
}

function executeDirectorCommand(command: string): void {
  const input = $<HTMLTextAreaElement>('#directorInput');
  const form = $<HTMLFormElement>('#directorForm');
  if (!input || !form) return;
  input.value = command;
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
}

function injectBuilderControls(): void {
  const fields = $('.face3d-fields');
  if (!fields || $('#adultSex')) return;
  fields.insertAdjacentHTML('afterbegin', `
    <label>Adult anatomy
      <select id="adultSex">
        <option value="female" selected>Female</option>
        <option value="male">Male</option>
      </select>
    </label>
    <label>Body preset
      <select id="adultBuildPreset">
        <option value="natural">Natural</option>
        <option value="athletic">Athletic</option>
        <option value="curvy">Curvy</option>
        <option value="slim">Slim</option>
      </select>
    </label>
  `);

  const sex = $<HTMLSelectElement>('#adultSex');
  const build = $<HTMLSelectElement>('#adultBuildPreset');
  sex?.addEventListener('change', () => applyBuilderPreset((sex.value as AdultSex) === 'male' ? 'male' : 'female'));
  build?.addEventListener('change', () => {
    const selected = build.value as AdultPreset;
    if (selected === 'natural') applyBuilderPreset((sex?.value as AdultSex) === 'male' ? 'male' : 'female');
    else applyBuilderPreset(selected);
  });
  applyBuilderPreset('female');
}

function injectLiveBodyControls(): void {
  const wardrobe = $('#wardrobeControls');
  if (!wardrobe || $('#adultBodyControls')) return;
  wardrobe.insertAdjacentHTML('beforebegin', `
    <details id="adultBodyControls" open>
      <summary>Realistic adult body</summary>
      <div class="manual-grid">
        <label class="wide">Anatomy / build
          <select id="liveAdultBodyPreset">
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="athletic">Athletic</option>
            <option value="curvy">Curvy</option>
            <option value="slim">Slim</option>
            <option value="natural">Natural</option>
          </select>
        </label>
        <button id="widerHips" type="button">Wider hips</button>
        <button id="smallerWaist" type="button">Smaller waist</button>
        <button id="broaderShoulders" type="button">Broader shoulders</button>
        <button id="biggerChest" type="button">Bigger chest</button>
      </div>
      <div class="mini-note" style="padding:0 13px 13px;margin:0">Adult human proportions only. Clothing, pose and body controls remain independent.</div>
    </details>
  `);
  $<HTMLSelectElement>('#liveAdultBodyPreset')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    const command = value === 'female' ? 'female body' : value === 'male' ? 'male body' : `${value} body`;
    executeDirectorCommand(command);
  });
  $('#widerHips')?.addEventListener('click', () => executeDirectorCommand('wider hips 10'));
  $('#smallerWaist')?.addEventListener('click', () => executeDirectorCommand('smaller waist 10'));
  $('#broaderShoulders')?.addEventListener('click', () => executeDirectorCommand('broader shoulders 10'));
  $('#biggerChest')?.addEventListener('click', () => executeDirectorCommand('bigger chest 10'));
}

function renameFaceMode(): void {
  document.querySelectorAll<HTMLElement>('#stageFace3d, #face3dCharacter').forEach((button) => { button.textContent = 'Face → Real Human 3D'; });
  const result = $('#rigModeNote');
  if (result && result.textContent?.includes('Landmark-built')) {
    result.textContent = result.textContent.replace('Landmark-built 3D', 'Realistic adult human 3D');
  }
}

function start(): void {
  injectBuilderControls();
  injectLiveBodyControls();
  renameFaceMode();
}

queueMicrotask(start);
