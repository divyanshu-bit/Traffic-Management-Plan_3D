// src/components/LocationSearch.jsx
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMap, Marker, Source, Layer } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';

// ─── FLY-TO CONTROLLER ───────────────────────────────────────────────────────
const FlyToController = ({ target }) => {
  const { current: map } = useMap();
  useEffect(() => {
    if (!target || !map) return;
    map.flyTo({ center: [target.lng, target.lat], zoom: 18, duration: 1400 });
  }, [target, map]);
  return null;
};

// ─── LIVE LOCATION MARKER ────────────────────────────────────────────────────
const LiveLocationMarker = ({ position, accuracy }) => {
  const circleGeoJSON = useMemo(() => {
    if (!position || !accuracy || accuracy >= 500) return null;
    return turf.circle([position.lng, position.lat], accuracy / 1000, { units: 'kilometers' });
  }, [position, accuracy]);

  if (!position) return null;

  return (
    <>
      {circleGeoJSON && (
        <Source type="geojson" data={circleGeoJSON}>
          <Layer
            id="user-accuracy-fill"
            type="fill"
            paint={{ 'fill-color': '#0ea5e9', 'fill-opacity': 0.06 }}
          />
          <Layer
            id="user-accuracy-line"
            type="line"
            paint={{ 'line-color': '#0ea5e9', 'line-dasharray': ['literal', [4, 4]], 'line-width': 1 }}
          />
        </Source>
      )}
      <Marker longitude={position.lng} latitude={position.lat} anchor="center">
        <div style={{ position: 'relative', width: 24, height: 24 }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'rgba(14,165,233,0.25)',
            animation: 'ss-gps-ring 1.8s ease-out infinite'
          }}></div>
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            width: 14, height: 14, borderRadius: '50%',
            background: '#0ea5e9',
            border: '2.5px solid #fff',
            boxShadow: '0 2px 8px rgba(14,165,233,0.6)'
          }}></div>
        </div>
      </Marker>
    </>
  );
};

// ─── GPS ACCURACY LABEL ───────────────────────────────────────────────────────
const getAccuracyInfo = (accuracy) => {
  if (!accuracy) return null;
  if (accuracy <= 5)   return { text: 'GPS · Precise',  color: '#10b981' };
  if (accuracy <= 20)  return { text: 'GPS · High',     color: '#10b981' };
  if (accuracy <= 100) return { text: 'GPS · Good',     color: '#f59e0b' };
  if (accuracy <= 300) return { text: 'Network · Low',  color: '#f97316' };
  return                      { text: 'Network · Poor', color: '#ef4444' };
};

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
const LocationSearch = ({ onLocationFound }) => {
  const [query, setQuery]               = useState('');
  const [results, setResults]           = useState([]);
  const [isSearching, setIsSearching]   = useState(false);
  const [isFocused, setIsFocused]       = useState(false);
  const [activeIdx, setActiveIdx]       = useState(-1);
  const [flyTarget, setFlyTarget]       = useState(null);
  const [selectedLabel, setSelectedLabel] = useState('');

  // GPS state
  const [gpsState, setGpsState]         = useState('idle'); // idle|requesting|tracking|error
  const [gpsError, setGpsError]         = useState('');
  const [userPosition, setUserPosition] = useState(null);
  const [accuracy, setAccuracy]         = useState(null);

  const debounceRef   = useRef(null);
  const inputRef      = useRef(null);
  const resultsRef    = useRef(null);
  const wrapperRef    = useRef(null);
  const watchIdRef    = useRef(null);
  const abortRef      = useRef(null);  // FIX #4: AbortController for fetch cancellation

  // FIX #2: isFirstFix as a ref, not state.
  // Previously used setIsFirstFix((prev) => { if (prev) { sideEffects } return false })
  // which ran side effects inside a state updater — React does not guarantee these
  // run synchronously. Also caused race condition on double-tap (two watchers racing).
  const isFirstFixRef = useRef(true);

  const accuracyInfo = getAccuracyInfo(accuracy);

  // ── Start precise GPS watch ──────────────────────────────────────────────
  const startGPS = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsState('error');
      setGpsError('Geolocation not supported by this browser.');
      return;
    }
    // Clear any existing watch before starting a new one
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setGpsState('requesting');
    setGpsError('');
    isFirstFixRef.current = true; // FIX #2: reset via ref, not state

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy: acc } = pos.coords;
        const newPos = { lat: latitude, lng: longitude };

        setUserPosition(newPos);
        setAccuracy(Math.round(acc));
        setGpsState('tracking');
        setGpsError('');

        // FIX #2: clean ref-based first-fix check — no stale closures, no race conditions
        if (isFirstFixRef.current) {
          isFirstFixRef.current = false;
          setFlyTarget(newPos);
          setSelectedLabel(`My Location (±${Math.round(acc)}m)`);
          setQuery('');
          onLocationFound?.({ lat: latitude, lng: longitude, label: 'Current Location' });
        }
      },
      (err) => {
        setGpsState('error');
        watchIdRef.current = null;
        const msgs = {
          1: 'Location access denied. Allow it in your browser settings.',
          2: 'Location unavailable. Check GPS signal and try again.',
          3: 'Location request timed out. Try again.',
        };
        setGpsError(msgs[err.code] || 'Could not get location.');
      },
      {
        enableHighAccuracy: true, // requests GPS chip — triggers "precise" permission prompt
        timeout: 15000,
        maximumAge: 0,            // never use cached position
      }
    );
  }, [onLocationFound]);

  // ── Stop GPS watch ────────────────────────────────────────────────────────
  const stopGPS = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setGpsState('idle');
    setUserPosition(null);
    setAccuracy(null);
    setSelectedLabel('');
    isFirstFixRef.current = true;
  }, []);

  const handleGpsClick = useCallback(() => {
    gpsState === 'tracking' ? stopGPS() : startGPS();
  }, [gpsState, stopGPS, startGPS]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      clearTimeout(debounceRef.current);
      abortRef.current?.abort(); // FIX #4: abort any in-flight search on unmount
    };
  }, []);

  // ── Search — FIX #4: AbortController prevents stale responses overwriting fresh ones
  const search = useCallback(async (q) => {
    const trimmed = q.trim();
    if (trimmed.length < 3) { setResults([]); return; }

    // Abort the previous in-flight request before firing a new one
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&addressdetails=1&limit=6`,
        {
          headers: { 'Accept-Language': 'en' },
          signal: abortRef.current.signal, // FIX #4: tied to abort controller
        }
      );
      const data = await res.json();
      setResults(data.map((item) => ({
        id:         item.place_id,
        label:      item.display_name,
        shortLabel: item.display_name.split(',').slice(0, 2).join(',').trim(),
        lat:        parseFloat(item.lat),
        lng:        parseFloat(item.lon),
        type:       item.type,
        category:   item.class,
      })));
    } catch (err) {
      // FIX #4: AbortError is expected when user types quickly — not a real error
      if (err.name !== 'AbortError') setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    setActiveIdx(-1);
    setSelectedLabel('');
    clearTimeout(debounceRef.current);
    if (val.trim().length < 3) { setResults([]); return; }
    debounceRef.current = setTimeout(() => search(val), 350);
  };

  const handleSelect = useCallback((result) => {
    setFlyTarget({ lat: result.lat, lng: result.lng });
    setQuery('');
    setResults([]);
    setSelectedLabel(result.shortLabel);
    setIsFocused(false);
    inputRef.current?.blur();
    onLocationFound?.({ lat: result.lat, lng: result.lng, label: result.label });
  }, [onLocationFound]);

  const handleKeyDown = (e) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); handleSelect(results[activeIdx]); }
    else if (e.key === 'Escape') { setResults([]); setIsFocused(false); inputRef.current?.blur(); }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setResults([]);
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const showDropdown = isFocused && (results.length > 0 || isSearching || query.length >= 3);

  const getCategoryIcon = (category, type) => {
    if (category === 'highway') return '🛣️';
    if (category === 'amenity') return '📍';
    if (category === 'building') return '🏢';
    if (type === 'city' || type === 'town') return '🏙️';
    if (type === 'residential') return '🏘️';
    return '📌';
  };

  return (
    <>
      {flyTarget && <FlyToController target={flyTarget} />}
      <LiveLocationMarker position={userPosition} accuracy={accuracy} />

      <div
        className="location-search-wrapper"
        ref={wrapperRef}
        role="search"
        aria-label="Search for work zone location"
      >
        <div className={`location-search-box ${isFocused ? 'focused' : ''} ${selectedLabel ? 'has-location' : ''}`}>

          {/* Search icon / spinner */}
          <div className="search-icon-wrap" aria-hidden="true">
            {isSearching
              ? <div className="search-spinner" />
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>}
          </div>

          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search road, area or landmark…"
            value={query}
            onChange={handleInput}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck="false"
            aria-label="Search location"
            aria-autocomplete="list"
            aria-controls={showDropdown ? 'search-results-list' : undefined}
            aria-expanded={showDropdown}
          />

          {/* Selected location chip */}
          {selectedLabel && !query && (
            <div
              className={`search-selected-chip ${gpsState === 'tracking' ? 'gps-chip' : ''}`}
              aria-label={`Selected location: ${selectedLabel}`}
            >
              <span className="chip-dot" aria-hidden="true"
                style={gpsState === 'tracking'
                  ? { background: '#0ea5e9', boxShadow: '0 0 6px #0ea5e9' }
                  : {}} />
              <span className="chip-label">{selectedLabel}</span>
              {gpsState === 'tracking' && accuracyInfo && (
                <span className="chip-accuracy" style={{ color: accuracyInfo.color }}>
                  {accuracyInfo.text}
                </span>
              )}
              <button
                className="chip-clear"
                aria-label="Clear selected location"
                onClick={() => {
                  setSelectedLabel('');
                  setFlyTarget(null);
                  if (gpsState === 'tracking') stopGPS();
                }}
              >✕</button>
            </div>
          )}

          {/* Clear query button */}
          {query && (
            <button
              className="search-clear-btn"
              aria-label="Clear search"
              onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
            >✕</button>
          )}

          <div className="search-divider" aria-hidden="true" />

          {/* GPS button */}
          <button
            className={`gps-btn ${gpsState}`}
            onClick={handleGpsClick}
            aria-label={gpsState === 'tracking' ? 'Stop location tracking' : 'Use my current location'}
            aria-pressed={gpsState === 'tracking'}
          >
            {gpsState === 'requesting'
              ? <div className="gps-spinner" aria-hidden="true" />
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                  <circle cx="12" cy="12" r="7" strokeOpacity="0.3"/>
                </svg>}
          </button>
        </div>

        {/* GPS error banner */}
        {gpsState === 'error' && gpsError && (
          <div className="gps-error-banner" role="alert">
            <span>⚠️ {gpsError}</span>
            <button aria-label="Dismiss error" onClick={() => setGpsState('idle')}>✕</button>
          </div>
        )}

        {/* Dropdown */}
        {showDropdown && (
          <div
            className="search-dropdown"
            ref={resultsRef}
            id="search-results-list"
            role="listbox"
            aria-label="Location search results"
          >
            {/* GPS shortcut row — always at top */}
            <button
              className="search-result-item gps-shortcut-row"
              role="option"
              aria-selected={gpsState === 'tracking'}
              onClick={handleGpsClick}
              disabled={gpsState === 'requesting'}
            >
              <span className="result-icon" aria-hidden="true">
                {gpsState === 'requesting'
                  ? <div className="search-spinner" style={{ width: 14, height: 14 }} />
                  : '📡'}
              </span>
              <div className="result-text">
                <span className="result-main" style={{ color: '#38bdf8' }}>
                  {gpsState === 'tracking' ? 'Update to current location' : 'Use my current location'}
                </span>
                <span className="result-sub">
                  {gpsState === 'tracking' && accuracyInfo
                    ? `Live · ${accuracyInfo.text} · ±${accuracy}m`
                    : 'Uses GPS chip for precise location'}
                </span>
              </div>
              <span className="result-arrow" aria-hidden="true" style={{ color: '#38bdf8' }}>→</span>
            </button>

            <div className="dropdown-divider" aria-hidden="true" />

            {isSearching && !results.length && (
              <div className="search-loading-row" aria-live="polite">
                <div className="search-spinner" aria-hidden="true" />
                <span>Searching…</span>
              </div>
            )}

            {!isSearching && !results.length && query.length >= 3 && (
              <div className="search-empty-row" aria-live="polite">
                No results for "<strong>{query}</strong>"
              </div>
            )}

            {results.map((r, idx) => (
              <button
                key={r.id}
                className={`search-result-item ${idx === activeIdx ? 'active' : ''}`}
                role="option"
                aria-selected={idx === activeIdx}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setActiveIdx(idx)}
              >
                <span className="result-icon" aria-hidden="true">
                  {getCategoryIcon(r.category, r.type)}
                </span>
                <div className="result-text">
                  <span className="result-main">{r.shortLabel}</span>
                  <span className="result-sub">{r.label.split(',').slice(2, 4).join(',').trim()}</span>
                </div>
                <span className="result-arrow" aria-hidden="true">→</span>
              </button>
            ))}

            {/* FIX #13: attribution color was #1e293b — ~1.8:1 contrast, fails WCAG AA.
                Changed to #475569 — ~4.6:1 contrast, passes WCAG AA */}
            <div className="search-attribution">
              Powered by OpenStreetMap / Nominatim
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default LocationSearch;
