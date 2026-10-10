import { useState, type ReactNode } from 'react';
import { AudioLines, Folder, Plus, Video, X } from 'lucide-react';
import { formatClock } from '../lib/format';

export type Point = { x: number; y: number };

const MENU_WIDTH = 228;

/** Menu position just under a button; `right` lines the menu's right edge up with the button. */
export function below(element: HTMLElement, side: 'left' | 'right' = 'left'): Point {
  const rect = element.getBoundingClientRect();
  return { x: side === 'right' ? rect.right - MENU_WIDTH : rect.left, y: rect.bottom + 6 };
}

/** Menu position at the pointer for right-click and long-press. */
export function atPointer(event: { clientX: number; clientY: number; preventDefault: () => void }): Point {
  event.preventDefault();
  return { x: event.clientX, y: event.clientY };
}

export type MenuItem = {
  id: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
};

export function Scrim({
  onClose,
  children,
  clear = false,
  locked = false,
}: {
  onClose: () => void;
  children: ReactNode;
  clear?: boolean;
  locked?: boolean;
}) {
  return (
    <div
      className={clear ? 'scrim clear' : 'scrim'}
      data-overlay
      onMouseDown={() => {
        if (!locked) onClose();
      }}
    >
      <div onMouseDown={(event) => event.stopPropagation()}>{children}</div>
    </div>
  );
}

export function AnchoredMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const width = 228;
  const height = items.length * 46 + 12;
  const left = Math.max(12, Math.min(x, window.innerWidth - width - 12));
  const top = Math.max(12, Math.min(y, window.innerHeight - height - 12));
  return (
    <Scrim clear onClose={onClose}>
      <div className="menu" style={{ left, top, width }} role="menu">
        {items.map((item) => (
          <button
            key={item.id}
            className={item.danger ? 'menu-item danger' : 'menu-item'}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </Scrim>
  );
}

export function AddMenu({
  onClose,
  onAudio,
  onConvert,
  onRecord,
  onFolder,
  onProject,
}: {
  onClose: () => void;
  onAudio: () => void;
  onConvert: () => void;
  onRecord: () => void;
  onFolder: () => void;
  onProject: () => void;
}) {
  return (
    <Scrim onClose={onClose}>
      <div className="add-stack">
        <div className="add-card" role="menu">
          <button className="add-row" onClick={onAudio}>
            <AudioLines size={20} strokeWidth={1.75} /> Audio
          </button>
          <button className="add-row" onClick={onConvert}>
            <Video size={20} strokeWidth={1.75} /> Convert
          </button>
          <button className="add-row" onClick={onRecord}>
            <span className="menu-icon" aria-hidden>
              <span className="menu-rec" />
            </span>
            Record
          </button>
          <button className="add-row" onClick={onFolder}>
            <Folder size={20} strokeWidth={1.75} /> New Folder
          </button>
          <button className="add-row" onClick={onProject}>
            <Plus size={20} strokeWidth={1.75} /> New Project
          </button>
        </div>
        <button className="close-pill" onClick={onClose}>
          <X size={16} /> Close
        </button>
      </div>
    </Scrim>
  );
}

export function RecordCard({
  elapsed,
  onStop,
  onCancel,
}: {
  elapsed: number;
  onStop: () => void;
  onCancel: () => void;
}) {
  return (
    <Scrim locked onClose={onCancel}>
      <div className="add-stack">
        <div className="record-card" role="dialog" aria-label="Recording">
          <span className="record-dot" />
          <div className="record-time">{formatClock(elapsed)}</div>
          <button className="record-stop" onClick={onStop}>
            Stop
          </button>
        </div>
        <button className="close-pill" onClick={onCancel}>
          <X size={16} /> Close
        </button>
      </div>
    </Scrim>
  );
}

export function NameDialog({
  title,
  placeholder,
  confirm,
  initial = '',
  onCancel,
  onConfirm,
}: {
  title: string;
  placeholder: string;
  confirm: string;
  initial?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Scrim onClose={onCancel}>
      <form
        className="dialog"
        role="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onConfirm(value.trim());
        }}
      >
        <h2>{title}</h2>
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
        <button className="white-btn" type="submit" disabled={!value.trim()}>
          {confirm}
        </button>
      </form>
    </Scrim>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirm,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirm: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Scrim onClose={onCancel}>
      <div className="dialog" role="dialog">
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="dialog-actions">
          <button className="text-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-btn" onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </Scrim>
  );
}

export function PickerDialog({
  title,
  choices,
  empty,
  confirm,
  multiple = false,
  createLabel,
  onClose,
  onConfirm,
  onCreate,
}: {
  title: string;
  choices: { id: string; label: string; detail?: string }[];
  empty: string;
  confirm: string;
  multiple?: boolean;
  createLabel?: string;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
  onCreate?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const filtered = choices.filter((choice) =>
    `${choice.label} ${choice.detail ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Scrim onClose={onClose}>
      <div className="dialog wide" role="dialog">
        <h2>{title}</h2>
        <input autoFocus value={query} placeholder="Search" onChange={(event) => setQuery(event.target.value)} />
        <div className="choice-list">
          {filtered.length === 0 ? <p className="empty-note">{empty}</p> : null}
          {filtered.map((choice) => {
            const on = picked.includes(choice.id);
            return (
              <button
                key={choice.id}
                className={on ? 'choice on' : 'choice'}
                onClick={() => {
                  if (!multiple) {
                    onConfirm([choice.id]);
                    return;
                  }
                  setPicked((current) =>
                    current.includes(choice.id) ? current.filter((id) => id !== choice.id) : [...current, choice.id],
                  );
                }}
              >
                <span>{choice.label}</span>
                {choice.detail ? <small>{choice.detail}</small> : null}
              </button>
            );
          })}
        </div>
        {multiple ? (
          <button className="white-btn" disabled={picked.length === 0} onClick={() => onConfirm(picked)}>
            {confirm}
            {picked.length ? ` ${picked.length}` : ''}
          </button>
        ) : null}
        {onCreate && createLabel ? (
          <button className="text-btn create-inline" onClick={onCreate}>
            {createLabel}
          </button>
        ) : null}
      </div>
    </Scrim>
  );
}
