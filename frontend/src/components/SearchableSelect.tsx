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
      style={{ position: "relative", width: "100%" }}
    >
      <div
        className="searchable-select-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          padding: "0.6rem 0.75rem",
          borderRadius: "10px",
          border: isOpen ? "1px solid #ea580c" : "1px solid var(--border-color)",
          background: disabled ? "var(--state-neutral-bg)" : "var(--card-bg)",
          color: disabled ? "var(--text-soft)" : "var(--text)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: "0.88rem",
          boxShadow: isOpen ? "0 0 0 3px rgba(234, 88, 12, 0.15)" : "none",
          transition: "border-color 0.2s, box-shadow 0.2s, background-color 0.2s",
          userSelect: "none"
        }}
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
            style={{
              width: "100%",
              border: "none",
              background: "transparent",
              outline: "none",
              padding: 0,
              margin: 0,
              fontSize: "inherit",
              fontFamily: "inherit",
              color: "inherit",
            }}
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
          />
        ) : (
          <span style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "calc(100% - 20px)"
          }}>
            {selectedOption ? selectedOption.label : (emptyLabel || placeholder)}
          </span>
        )}
        <span style={{
          fontSize: "0.65rem",
          color: "var(--color-accent)",
          transition: "transform 0.22s ease",
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)"
        }}>
          ▼
        </span>
      </div>

      {isOpen && (
        <div
          className="searchable-select-dropdown"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "6px",
            background: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: "10px",
            boxShadow: "0 10px 25px -5px rgba(154, 79, 15, 0.15), 0 8px 10px -6px rgba(154, 79, 15, 0.15)",
            zIndex: 1000,
            maxHeight: "280px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "selectDropdownFade 0.18s cubic-bezier(0.16, 1, 0.3, 1)"
          }}
        >
          {!allowFreeText && (
            <div style={{ padding: "0.5rem", borderBottom: "1px solid var(--border-color)", background: "var(--card-bg)" }}>
              <input
                ref={searchInputRef}
                type="text"
                placeholder={placeholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  padding: "0.4rem 0.6rem",
                  fontSize: "0.82rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  background: "var(--card-bg)",
                  color: "var(--text)",
                  outline: "none",
                  boxSizing: "border-box"
                }}
              />
            </div>
          )}

          <div
            ref={optionsListRef}
            className="searchable-select-list"
            style={{
              overflowY: "auto",
              flex: 1,
              maxHeight: "220px",
              padding: "0.25rem 0"
            }}
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
                style={{
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  color: value === "" ? "var(--color-accent)" : "var(--text)",
                  background: value === ""
                    ? "var(--color-accent-10)"
                    : highlightedIndex === -1
                      ? "var(--color-accent-05)"
                      : "transparent",
                  fontWeight: value === "" ? 700 : 400,
                  transition: "background-color 0.1s"
                }}
              >
                {emptyLabel}
              </div>
            )}

            {filteredOptions.length === 0 ? (
              <div style={{ padding: "0.6rem 0.75rem", fontSize: "0.82rem", color: "var(--text-soft)", fontStyle: "italic", textAlign: "center" }}>
                No se encontraron resultados
              </div>
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
                    style={{
                      padding: "0.5rem 0.75rem",
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      color: isSelected ? "var(--color-accent)" : "var(--text)",
                      background: isSelected
                        ? "var(--color-accent-10)"
                        : isHighlighted
                          ? "var(--color-accent-05)"
                          : "transparent",
                      fontWeight: isSelected ? 700 : 400,
                      transition: "background-color 0.1s",
                      display: "flex",
                      alignItems: "center"
                    }}
                  >
                    <span>
                      {hasSearch ? (
                        parts.map((part, i) => 
                          part.toLowerCase() === search.toLowerCase() ? (
                            <mark key={i} style={{ background: "#fde047", color: "inherit", padding: "0.05rem 0.1rem", borderRadius: "2px" }}>
                              {part}
                            </mark>
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
