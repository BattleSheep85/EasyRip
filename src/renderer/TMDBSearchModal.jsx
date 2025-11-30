// TMDB Search Modal - Search and select from TMDB results
import React, { useState, useEffect, useCallback } from 'react';

// TMDB Image base URL
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function TMDBSearchModal({ initialQuery, initialYear, onSelect, onClose }) {
  const [query, setQuery] = useState(initialQuery || '');
  const [year, setYear] = useState(initialYear || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Auto-search on mount if we have an initial query
  useEffect(() => {
    if (initialQuery) {
      handleSearch();
    }
  }, []);

  async function handleSearch() {
    if (!window.electronAPI || !query.trim()) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const result = await window.electronAPI.searchTMDB(query.trim(), year ? parseInt(year, 10) : null);
      if (result.success) {
        setResults(result.results);
      } else {
        setError(result.error);
        setResults([]);
      }
    } catch (err) {
      setError(err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyPress(e) {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }

  function handleSelectResult(result) {
    onSelect(result);
    onClose();
  }

  // Get poster URL
  function getPosterUrl(posterPath, size = 'w92') {
    if (!posterPath) return null;
    return `${TMDB_IMAGE_BASE}/${size}${posterPath}`;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Search TMDB</h3>
          <button className="modal-close" onClick={onClose}>X</button>
        </div>

        <div className="modal-body tmdb-search-body">
          {/* Search Form */}
          <div className="search-form">
            <div className="search-inputs">
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Search for movie or TV show..."
                className="search-input"
                autoFocus
              />
              <input
                type="number"
                value={year}
                onChange={e => setYear(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Year"
                className="year-input"
                min="1900"
                max="2099"
              />
              <button
                className="btn btn-primary"
                onClick={handleSearch}
                disabled={loading || !query.trim()}
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button onClick={() => setError(null)}>X</button>
            </div>
          )}

          {/* Results */}
          <div className="search-results">
            {loading ? (
              <div className="loading-indicator">Searching TMDB...</div>
            ) : results.length === 0 ? (
              <div className="no-results">
                {hasSearched
                  ? `No results found for "${query}"`
                  : 'Enter a search query above'}
              </div>
            ) : (
              <div className="results-list">
                {results.map(result => (
                  <div
                    key={`${result.mediaType}-${result.id}`}
                    className="result-item"
                    onClick={() => handleSelectResult(result)}
                  >
                    {/* Poster */}
                    <div className="result-poster">
                      {result.posterPath ? (
                        <img
                          src={getPosterUrl(result.posterPath)}
                          alt={result.title}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="no-poster-small">
                          {result.mediaType === 'tv' ? 'TV' : 'M'}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="result-info">
                      <div className="result-title">
                        {result.title}
                        {result.year && <span className="result-year"> ({result.year})</span>}
                      </div>
                      <div className="result-type">
                        <span className={`type-badge ${result.mediaType}`}>
                          {result.mediaType === 'tv' ? 'TV Show' : 'Movie'}
                        </span>
                        {result.voteAverage > 0 && (
                          <span className="result-rating">
                            ★ {result.voteAverage.toFixed(1)}
                          </span>
                        )}
                      </div>
                      {result.overview && (
                        <div className="result-overview">
                          {result.overview.length > 150
                            ? `${result.overview.substring(0, 150)}...`
                            : result.overview}
                        </div>
                      )}
                    </div>

                    {/* Select button */}
                    <div className="result-action">
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectResult(result);
                        }}
                      >
                        Select
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <small>Results from The Movie Database (TMDB)</small>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default TMDBSearchModal;
