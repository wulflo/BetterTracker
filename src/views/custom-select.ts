/**
 * CustomSelect — reemplaza el `<select>` nativo por un botón + menú desplegado
 * construidos con los estilos del tema de la app (`.select`, `.select-trigger`,
 * `.select-menu`, `.select-option`).
 *
 * `migrateSelect()` aplica la conversión a un select ya existente en el DOM.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface CustomSelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** Conveniencia: `React.createElement` con tipos amplios para el helper. */
const h = (type: any, props: any, ...children: any[]): React.ReactElement =>
  React.createElement(type, props, ...children);

const el = (props: any, text: string): React.ReactElement => h('span', props, text);

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className = '',
}: CustomSelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setActive(idx >= 0 ? idx : 0);
    }
  }, [open, options, value]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[active];
      if (opt) choose(opt.value);
    }
  };

  const chevron = h('svg', {
    className: `select-chevron ${open ? 'open' : ''}`,
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true,
  }, h('path', {
    d: 'M6 9l6 6 6-6',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }));

  const menu = open
    ? h('div', { className: 'select-menu', role: 'listbox', tabIndex: -1 },
        options.map((opt, i) => h('button', {
          key: opt.value,
          type: 'button',
          role: 'option',
          'aria-selected': opt.value === value,
          className: `select-option ${opt.value === value ? 'selected' : ''} ${i === active ? 'active' : ''}`,
          onMouseEnter: () => setActive(i),
          onClick: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            choose(opt.value);
          },
        },
          el({ className: 'select-option-label' }, opt.label),
          opt.hint ? el({ className: 'select-option-hint' }, opt.hint) : null,
        )),
      )
    : null;

  return h('div', { ref: rootRef, className: `select ${className}` },
    h('button', {
      type: 'button',
      ref: triggerRef,
      className: 'select-trigger',
      disabled,
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        setOpen((o) => !o);
      },
      onKeyDown,
    },
      el(selected ? { className: 'select-value' } : { className: 'select-placeholder' }, selected ? selected.label : (placeholder ?? '')),
      chevron,
    ),
    menu,
  );
}

export interface MigrateSelectOptions {
  /** Opciones a usar; por defecto se leen del select. */
  source?: CustomSelectOption[];
  selected?: string;
  onChange?: (value: string) => void;
  onSelect?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Convierte un `<select>` nativo ya presente en el DOM en un CustomSelect:
 * crea un botón con la clase `select-trigger` y un menú desplegado
 * (`select-menu`/`select-option`) con los estilos del tema, reemplazando al
 * elemento nativo. Devuelve el botón creado.
 */
export function migrateSelect(
  select: HTMLSelectElement,
  options: MigrateSelectOptions = {},
): HTMLButtonElement {
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error('migrateSelect necesita un elemento <select>.');
  }
  const readOptions = (): CustomSelectOption[] =>
    Array.from(select.options).map((o) => ({ value: o.value, label: o.textContent?.trim() ?? o.value }));
  const source = options.source ?? readOptions();
  const value = options.selected ?? select.value;
  const set = (v: string) => {
    options.onSelect?.(v);
    options.onChange?.(v);
  };

  const root = document.createElement('div');
  root.className = `select ${options.className ?? ''}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'select-trigger';
  if (options.disabled) button.disabled = true;

  const label = document.createElement('span');
  const sel = source.find((o) => o.value === value);
  label.className = sel ? 'select-value' : 'select-placeholder';
  label.textContent = sel ? sel.label : options.placeholder ?? '';
  button.appendChild(label);

  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('class', 'select-chevron');
  chevron.setAttribute('width', '16');
  chevron.setAttribute('height', '16');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.setAttribute('fill', 'none');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6 9l6 6 6-6');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  chevron.appendChild(path);
  button.appendChild(chevron);

  const menu = document.createElement('div');
  menu.className = 'select-menu';
  menu.setAttribute('role', 'listbox');
  for (const opt of source) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `select-option ${opt.value === value ? 'selected' : ''}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(opt.value === value));
    const itemLabel = document.createElement('span');
    itemLabel.className = 'select-option-label';
    itemLabel.textContent = opt.label;
    item.appendChild(itemLabel);
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
      set(opt.value);
      button.focus();
    });
    menu.appendChild(item);
  }

  let open = false;
  const close = () => {
    if (open) {
      menu.remove();
      open = false;
    }
  };

  button.addEventListener('click', (e) => {
    e.preventDefault();
    if (open) {
      close();
      return;
    }
    close();
    root.appendChild(menu);
    open = true;
  });

  document.addEventListener('pointerdown', (e) => {
    if (open && root.contains(e.target as Node)) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') close();
  });

  root.appendChild(button);
  select.replaceWith(root);
  return button;
}
