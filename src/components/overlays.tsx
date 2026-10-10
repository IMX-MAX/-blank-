import { useState, type ReactNode } from 'react';
import { AudioLines, Folder, Plus, X } from 'lucide-react';

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
}: {
  onClose: () => void;
  children: ReactNode;
  clear?: boolean;
}) {
  return (
    <div className={clear ? 'scrim clear' : 'scrim'} data-overlay onMouseDown={onClose}>
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

export function AddMenu({ onClose, onAudio, onFolder, onPlaylist }: {
  onClose: () => void;
  onAudio: () => void;
  onFolder: () => void;
  onPlaylist: () => void;
}) {
  return (
    <Scrim onClose={onClose}>
      <div className="add-stack">
        <div className="add-card" role="menu">
          <button className="add-row" onClick={onAudio}>
            <AudioLines size={20} /> Audio
          </button>
          <button className="add-row" onClick={onFolder}>
            <Folder size={20} /> New Folder
          </button>
          <button className="add-row" onClick={onPlaylist}>
            <Plus size={20} /> New Playlist
          </button>
        </div>
        <button className="close-pill" onClick={onClose}>
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
  onClose,
  onConfirm,
}: {
  title: string;
  choices: { id: string; label: string; detail?: string }[];
  empty: string;
  confirm: string;
  multiple?: boolean;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
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
      </div>
    </Scrim>
  );
}
