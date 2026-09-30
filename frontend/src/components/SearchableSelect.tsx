import React, { useState, useEffect, useRef } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  allowFreeText?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Buscar...",
  emptyLabel = "-- Seleccionar --",
  disabled = false,
  allowFreeText = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((opt) => opt.value === value);
  const [search, setSearch] = useState(() => {
    if (allowFreeText) {
      return selectedOption ? selectedOption.label : value;
    }
    return "";
  });
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionsListRef = useRef<HTMLDivElement>(null);

  // Derived state adjustments during render
  const [prevValue, setPrevValue] = useState(value);
  const [prevSearch, setPrevSearch] = useState(search);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  if (value !== prevValue) {
    setPrevValue(value);
    if (allowFreeText) {
      setSearch(selectedOption ? selectedOption.label : value);
    }
  }

  if (search !== prevSearch || isOpen !== prevIsOpen) {
    setPrevSearch(search);
    setPrevIsOpen(isOpen);
    setHighlightedIndex(-1);
  }

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter options based on search query
  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  );

  // Focus search input when dropdown opens (only in static select mode)
  useEffect(() => {
    if (!allowFreeText && isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, allowFreeText]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    const maxIndex = filteredOptions.length - (emptyLabel ? 0 : 1);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev >= maxIndex ? (emptyLabel ? -1 : 0) : prev + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev <= (emptyLabel ? -1 : 0) ? maxIndex : prev - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex === -1 && emptyLabel) {
        onChange("");
        setIsOpen(false);
        setSearch("");
      } else if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        onChange(filteredOptions[highlightedIndex].value);
        setIsOpen(false);
        setSearch("");
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setSearch("");
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && optionsListRef.current) {
      const listEl = optionsListRef.current;
      const itemEl = listEl.children[emptyLabel ? highlightedIndex + 1 : highlightedIndex] as HTMLElement;
      if (itemEl) {
        const listHeight = listEl.clientHeight;
        const itemTop = itemEl.offsetTop;
        const itemHeight = itemEl.clientHeight;

        if (itemTop + itemHeight > listEl.scrollTop + listHeight) {
          listEl.scrollTop = itemTop + itemHeight - listHeight;
        } else if (itemTop < listEl.scrollTop) {
          listEl.scrollTop = itemTop;
        }
      }
    }
  }, [highlightedIndex, emptyLabel]);

  return (
    <div
      ref={containerRef}
      className={`searchable-select-container ${isOpen ? "is-open" : ""} ${disabled ? "is-disabled" : ""}`}
      onKeyDown={handleKeyDown}
    >
      <div
        className="searchable-select-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        {allowFreeText ? (
          <input
            type="text"
            value={search}
            onChange={(e) => {
              const val = e.target.value;
              setSearch(val);
              onChange(val);
              setIsOpen(true);
            }}
            placeholder={placeholder}
            disabled={disabled}
            className="searchable-select-freetext"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
          />
        ) : (
          <span className="searchable-select-value">
            {selectedOption ? selectedOption.label : (emptyLabel || placeholder)}
          </span>
        )}
        <span className="searchable-select-caret" aria-hidden="true">▼</span>
      </div>

      {isOpen && (
        <div
          className="searchable-select-dropdown"
        >
          {!allowFreeText && (
            <div className="searchable-select-search">
              <input
                ref={searchInputRef}
                type="text"
                placeholder={placeholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="searchable-select-search__input"
                aria-label={placeholder}
              />
            </div>
          )}

          <div
            ref={optionsListRef}
            className="searchable-select-list"
          >
            {emptyLabel && (!allowFreeText ? search === "" : true) && (
              <div
                className={`searchable-select-option ${value === "" ? "is-selected" : ""} ${highlightedIndex === -1 ? "is-highlighted" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                  setIsOpen(false);
                  setSearch("");
                }}
                onMouseEnter={() => setHighlightedIndex(-1)}
              >
                {emptyLabel}
              </div>
            )}

            {filteredOptions.length === 0 ? (
              <div className="searchable-select-empty">No se encontraron resultados</div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = value === opt.value;
                const isHighlighted = highlightedIndex === idx;
                
                // Highlight search matches (escape regex chars to prevent runtime errors)
                const hasSearch = search.trim() !== "";
                const escapedSearch = search
                  .replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&")
                  .replace(/\//g, "\\$&");
                const parts = hasSearch 
                  ? opt.label.split(new RegExp(`(${escapedSearch})`, "gi")) 
                  : [opt.label];
                
                return (
                  <div
                    key={opt.value}
                    className={`searchable-select-option ${isSelected ? "is-selected" : ""} ${isHighlighted ? "is-highlighted" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(opt.value);
                      setIsOpen(false);
                      if (allowFreeText) {
                        setSearch(opt.label);
                      } else {
                        setSearch("");
                      }
                    }}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                  >
                    <span>
                      {hasSearch ? (
                        parts.map((part, i) => 
                          part.toLowerCase() === search.toLowerCase() ? (
                            <mark key={i} className="searchable-select-mark">{part}</mark>
                          ) : (
                            part
                          )
                        )
                      ) : (
                        opt.label
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
