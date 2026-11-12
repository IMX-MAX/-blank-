import { useState } from 'react';
import { Check, Moon, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  BAND_LIMIT,
  BUILT_IN_PRESETS,
  EQ_FREQUENCIES,
  PREAMP_MAX,
  PREAMP_MIN,
  applyPreset,
  editEq,
  formatDb,
  formatHz,
  saveCustomPreset,
  type EqPreset,
} from '../lib/equaliser';
import { useSettings } from '../state/SettingsProvider';
import { EqualizerGraph } from './EqualizerGraph';
import { NameDialog } from './overlays';
import { Presence } from './Presence';

/** The equaliser screen: on/off, the curve, ten band sliders, preamp, presets and saved presets. */
export function EqualiserView({ notify }: { notify: (message: string) => void }) {
  const { eq, setEq, eqPresets, setEqPresets } = useSettings();
  const [naming, setNaming] = useState(false);
  const all = [...BUILT_IN_PRESETS, ...eqPresets];
  const selected = all.find((preset) => preset.id === eq.preset);
  const selectedCustom = eqPresets.find((preset) => preset.id === eq.preset);

  const setBand = (band: number, value: number) => setEq(editEq(eq, { band, value }, all));
  const pick = (preset: EqPreset) => setEq(applyPreset(eq, preset));

  return (
    <main className="stage settings-page eq-page">
      <div className="eq-title-row">
        <h1 className="settings-title">Equaliser</h1>
        <button
          className={eq.enabled ? 'switch on' : 'switch'}
          role="switch"
          aria-checked={eq.enabled}
          aria-label="Equaliser on"
          onClick={() => setEq({ ...eq, enabled: !eq.enabled })}
        >
          <span />
        </button>
      </div>
      <p className="eq-status">
        {eq.enabled ? (
          <>
            {selected ? selected.name : 'Custom'}
            {eq.night ? (
              <span className="eq-badge">
                <Moon size={12} /> Evened out
              </span>
            ) : null}
          </>
        ) : (
          'Off. Your settings are kept for when you switch it back on.'
        )}
      </p>

      <section className={eq.enabled ? 'eq-card' : 'eq-card off'}>
        <EqualizerGraph bands={eq.bands} preamp={eq.preamp} enabled={eq.enabled} onBand={setBand} />
        <div className="eq-sliders" role="group" aria-label="Bands">
          {EQ_FREQUENCIES.map((hz, band) => (
            <label key={hz} className="eq-band">
              <span className="eq-band-value">{eq.bands[band]! > 0 ? '+' : ''}{eq.bands[band]}</span>
              <input
                type="range"
                className="eq-vslider"
                min={-BAND_LIMIT}
                max={BAND_LIMIT}
                step={0.5}
                value={eq.bands[band]}
                aria-label={`${formatHz(hz)}Hz`}
                aria-valuetext={formatDb(eq.bands[band]!)}
                onChange={(event) => setBand(band, Number(event.target.value))}
                onDoubleClick={() => setBand(band, 0)}
              />
              <span className="eq-band-hz">{formatHz(hz)}</span>
            </label>
          ))}
        </div>
        <label className="eq-preamp">
          <span className="eq-preamp-label">Preamp</span>
          <input
            type="range"
            min={PREAMP_MIN}
            max={PREAMP_MAX}
            step={0.5}
            value={eq.preamp}
            aria-label="Preamp"
            aria-valuetext={formatDb(eq.preamp)}
            onChange={(event) => setEq(editEq(eq, { preamp: Number(event.target.value) }, all))}
          />
          <span className="eq-preamp-value">{formatDb(eq.preamp)}</span>
        </label>
      </section>

      <section className="settings-group">
        <h2>Presets</h2>
        <div className="eq-presets">
          {BUILT_IN_PRESETS.map((preset) => (
            <button key={preset.id} className={eq.preset === preset.id ? 'eq-chip on' : 'eq-chip'} aria-pressed={eq.preset === preset.id} onClick={() => pick(preset)}>
              {eq.preset === preset.id ? <Check size={14} /> : null}
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h2>Your presets</h2>
        <div className="eq-presets">
          {eqPresets.map((preset) => (
            <button key={preset.id} className={eq.preset === preset.id ? 'eq-chip on' : 'eq-chip'} aria-pressed={eq.preset === preset.id} onClick={() => pick(preset)}>
              {eq.preset === preset.id ? <Check size={14} /> : null}
              {preset.name}
            </button>
          ))}
          <button className="eq-chip add" onClick={() => setNaming(true)}>
            <Plus size={14} /> Save current sound
          </button>
        </div>
        {!eqPresets.length ? <p className="settings-hint eq-note">Shape the sound, then save it here to come back to it.</p> : null}
        <div className="eq-actions">
          {selectedCustom ? (
            <button
              className="pill-btn subtle"
              onClick={() => {
                setEqPresets(eqPresets.filter((preset) => preset.id !== selectedCustom.id));
                setEq({ ...eq, preset: 'custom' });
                notify(`Deleted ${selectedCustom.name}`);
              }}
            >
              <Trash2 size={15} /> Delete “{selectedCustom.name}”
            </button>
          ) : null}
          <button className="pill-btn subtle" disabled={eq.preset === 'flat' && eq.enabled} onClick={() => pick(BUILT_IN_PRESETS[0]!)}>
            <RotateCcw size={15} /> Reset to Flat
          </button>
        </div>
      </section>

      <p className="settings-hint eq-foot">
        The equaliser shapes everything you play, including crossfades, and keeps working with the screen off. Presets that boost lower the
        preamp so loud songs do not distort.
      </p>

      <Presence show={naming}>
        <NameDialog
          title="Save preset"
          placeholder="Preset name"
          confirm="Save"
          initial={selectedCustom?.name ?? ''}
          onCancel={() => setNaming(false)}
          onConfirm={(name) => {
            setNaming(false);
            const result = saveCustomPreset(eqPresets, name, eq);
            setEqPresets(result.presets);
            setEq({ ...eq, preset: result.preset.id });
            notify(`Saved ${result.preset.name}`);
          }}
        />
      </Presence>
    </main>
  );
}
