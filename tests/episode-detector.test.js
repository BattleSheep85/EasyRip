/**
 * Episode Detector Tests
 * Tests for the intelligent TV episode detection system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EpisodeDetector } from '../src/main/metadata/episode-detector.js';

// Mock TMDB client
const createMockTMDBClient = () => ({
  getTVDetails: vi.fn()
});

// Mock disc parsing functions
vi.mock('../src/main/metadata/parser-bluray.js', () => ({
  parseBlurayStructure: vi.fn()
}));

vi.mock('../src/main/metadata/parser-dvd.js', () => ({
  parseDVDStructure: vi.fn()
}));

import { parseBlurayStructure } from '../src/main/metadata/parser-bluray.js';
import { parseDVDStructure } from '../src/main/metadata/parser-dvd.js';

describe('EpisodeDetector', () => {
  let detector;
  let mockTMDB;

  beforeEach(() => {
    mockTMDB = createMockTMDBClient();
    detector = new EpisodeDetector(mockTMDB);
    vi.clearAllMocks();
  });

  describe('Volume Label Parsing', () => {
    it('should parse S1D6 pattern', () => {
      const result = detector._parseVolumeLabel('OTH_S1D6');
      expect(result).toEqual({ seasonNumber: 1, discNumber: 6 });
    });

    it('should parse S01D06 pattern', () => {
      const result = detector._parseVolumeLabel('SHOW_S01D06');
      expect(result).toEqual({ seasonNumber: 1, discNumber: 6 });
    });

    it('should parse SEASON_1_DISC_6 pattern', () => {
      const result = detector._parseVolumeLabel('LOST_SEASON_1_DISC_6');
      expect(result).toEqual({ seasonNumber: 1, discNumber: 6 });
    });

    it('should parse season only (S01)', () => {
      const result = detector._parseVolumeLabel('BREAKING_BAD_S01');
      expect(result).toEqual({ seasonNumber: 1, discNumber: null });
    });

    it('should parse disc only (D06)', () => {
      const result = detector._parseVolumeLabel('SHOW_D06');
      expect(result).toEqual({ seasonNumber: null, discNumber: 6 });
    });

    it('should handle no markers', () => {
      const result = detector._parseVolumeLabel('SOME_MOVIE');
      expect(result).toEqual({ seasonNumber: null, discNumber: null });
    });

    it('should handle null/empty label', () => {
      expect(detector._parseVolumeLabel(null)).toEqual({ seasonNumber: null, discNumber: null });
      expect(detector._parseVolumeLabel('')).toEqual({ seasonNumber: null, discNumber: null });
    });
  });

  describe('Disc Episode Detection', () => {
    it('should detect episodes from Blu-ray disc', async () => {
      // Mock Blu-ray structure with 22 episodes
      parseBlurayStructure.mockResolvedValue({
        titles: [
          { index: 0, duration: 2640 }, // 44 min - episode
          { index: 1, duration: 2700 }, // 45 min - episode
          { index: 2, duration: 2580 }, // 43 min - episode
          { index: 3, duration: 300 },  // 5 min - not episode
          ...Array(19).fill(null).map((_, i) => ({ index: i + 4, duration: 2640 }))
        ]
      });

      const result = await detector.detectDiscEpisodes('/path/to/disc', 'bluray');

      expect(result.episodeCount).toBe(22);
      expect(result.titles.length).toBe(22);
      expect(parseBlurayStructure).toHaveBeenCalledWith('/path/to/disc');
    });

    it('should detect episodes from DVD disc', async () => {
      // Mock DVD structure with 24 episodes
      parseDVDStructure.mockResolvedValue({
        titles: Array(24).fill(null).map((_, i) => ({
          index: i,
          duration: 2640 // 44 min
        }))
      });

      const result = await detector.detectDiscEpisodes('/path/to/disc', 'dvd');

      expect(result.episodeCount).toBe(24);
      expect(parseDVDStructure).toHaveBeenCalledWith('/path/to/disc');
    });

    it('should filter out non-episode titles (too short)', async () => {
      parseBlurayStructure.mockResolvedValue({
        titles: [
          { index: 0, duration: 2640 }, // 44 min - episode
          { index: 1, duration: 300 },  // 5 min - too short
          { index: 2, duration: 600 }   // 10 min - too short
        ]
      });

      const result = await detector.detectDiscEpisodes('/path/to/disc', 'bluray');

      expect(result.episodeCount).toBe(1);
    });

    it('should filter out non-episode titles (too long)', async () => {
      parseBlurayStructure.mockResolvedValue({
        titles: [
          { index: 0, duration: 2640 }, // 44 min - episode
          { index: 1, duration: 7200 }  // 120 min - movie, too long
        ]
      });

      const result = await detector.detectDiscEpisodes('/path/to/disc', 'bluray');

      expect(result.episodeCount).toBe(1);
    });

    it('should handle parse errors gracefully', async () => {
      parseBlurayStructure.mockRejectedValue(new Error('Parse failed'));

      const result = await detector.detectDiscEpisodes('/path/to/disc', 'bluray');

      expect(result.episodeCount).toBe(0);
      expect(result.error).toBe('Parse failed');
    });

    it('should handle missing titles', async () => {
      parseBlurayStructure.mockResolvedValue({ titles: null });

      const result = await detector.detectDiscEpisodes('/path/to/disc', 'bluray');

      expect(result.episodeCount).toBe(0);
      expect(result.error).toBe('No titles found');
    });
  });

  describe('Fetch Series Episode Info', () => {
    it('should fetch One Tree Hill season data', async () => {
      mockTMDB.getTVDetails.mockResolvedValue({
        name: 'One Tree Hill',
        seasons: [
          { season_number: 0, episode_count: 5 },  // Specials
          { season_number: 1, episode_count: 22, name: 'Season 1', air_date: '2003-09-23' },
          { season_number: 2, episode_count: 23, name: 'Season 2', air_date: '2004-09-21' },
          { season_number: 6, episode_count: 24, name: 'Season 6', air_date: '2008-09-01' }
        ]
      });

      const result = await detector.fetchSeriesEpisodeInfo(2108);

      expect(result.totalSeasons).toBe(3); // Excludes specials
      expect(result.seasons).toHaveLength(3);
      expect(result.seasons[0]).toEqual({
        season: 1,
        episodeCount: 22,
        name: 'Season 1',
        airDate: '2003-09-23'
      });
      expect(result.seriesName).toBe('One Tree Hill');
    });

    it('should handle missing season data', async () => {
      mockTMDB.getTVDetails.mockResolvedValue({
        name: 'Unknown Show',
        seasons: null
      });

      const result = await detector.fetchSeriesEpisodeInfo(999);

      expect(result.totalSeasons).toBe(0);
      expect(result.seasons).toEqual([]);
    });

    it('should handle API errors', async () => {
      mockTMDB.getTVDetails.mockRejectedValue(new Error('API error'));

      const result = await detector.fetchSeriesEpisodeInfo(999);

      expect(result.totalSeasons).toBe(0);
      expect(result.error).toBe('API error');
    });
  });

  describe('Correlation Heuristic H1 - Disc N = Season N', () => {
    const seriesInfo = {
      totalSeasons: 6,
      seasons: [
        { season: 1, episodeCount: 22 },
        { season: 2, episodeCount: 23 },
        { season: 6, episodeCount: 24 }
      ]
    };

    it('should match disc 6 = season 6 with 24 episodes (perfect match)', async () => {
      const result = await detector.correlateDiscToEpisodes({
        discNumber: 6,
        extractedEpisodeCount: 24,
        currentSeasonHint: null,
        seriesInfo
      });

      expect(result.season).toBe(6);
      expect(result.episodeCount).toBe(24);
      expect(result.confidence).toBe(0.95);
      expect(result.heuristicUsed).toBe('H1-DiscEqualsSeasonWithMatch');
    });

    it('should match disc 1 = season 1 with 22 episodes', async () => {
      const result = await detector.correlateDiscToEpisodes({
        discNumber: 1,
        extractedEpisodeCount: 22,
        currentSeasonHint: null,
        seriesInfo
      });

      expect(result.season).toBe(1);
      expect(result.confidence).toBe(0.95);
    });

    it('should handle close match (within 2 episodes)', async () => {
      const result = await detector.correlateDiscToEpisodes({
        discNumber: 1,
        extractedEpisodeCount: 23, // Season 1 has 22
        currentSeasonHint: null,
        seriesInfo
      });

      expect(result.season).toBe(1);
      expect(result.confidence).toBe(0.85);
      expect(result.heuristicUsed).toBe('H1-DiscEqualsSeasonCloseMatch');
    });

    it('should fail H1 if disc number not in series', async () => {
      const result = await detector.correlateDiscToEpisodes({
        discNumber: 10, // Series only has 6 seasons
        extractedEpisodeCount: 22,
        currentSeasonHint: null,
        seriesInfo
      });

      // Should match on H2 (unique episode count of 22 = season 1)
      // This is actually a successful match via H2!
      expect(result.season).toBe(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    });
  });

  describe('Correlation Heuristic H2 - Episode Count Match', () => {
    const seriesInfo = {
      totalSeasons: 6,
      seasons: [
        { season: 1, episodeCount: 22 },
        { season: 2, episodeCount: 23 },
        { season: 6, episodeCount: 24 }
      ]
    };

    it('should match unique episode count (24 episodes = season 6)', async () => {
      const result = await detector.correlateDiscToEpisodes({
        discNumber: null,
        extractedEpisodeCount: 24,
        currentSeasonHint: null,
        seriesInfo
      });

      expect(result.season).toBe(6);
      expect(result.episodeCount).toBe(24);
      expect(result.confidence).toBe(0.90);
      expect(result.heuristicUsed).toBe('H2-UniqueEpisodeCountMatch');
    });

    it('should handle multiple seasons with same episode count', async () => {
      const multiMatchInfo = {
        totalSeasons: 4,
        seasons: [
          { season: 1, episodeCount: 22 },
          { season: 2, episodeCount: 22 }, // Same as S1
          { season: 3, episodeCount: 23 }
        ]
      };

      const result = await detector.correlateDiscToEpisodes({
        discNumber: null,
        extractedEpisodeCount: 22,
        currentSeasonHint: null,
        seriesInfo: multiMatchInfo
      });

      // Should use first match (lowest season)
      expect(result.season).toBe(1);
      expect(result.confidence).toBe(0.75);
      expect(result.heuristicUsed).toBe('H2-MultipleMatchesDefaultFirst');
    });

    it('should use season hint when multiple matches exist', async () => {
      const multiMatchInfo = {
        totalSeasons: 4,
        seasons: [
          { season: 1, episodeCount: 22 },
          { season: 2, episodeCount: 22 },
          { season: 3, episodeCount: 23 }
        ]
      };

      const result = await detector.correlateDiscToEpisodes({
        discNumber: null,
        extractedEpisodeCount: 22,
        currentSeasonHint: 2, // Hint toward season 2
        seriesInfo: multiMatchInfo
      });

      expect(result.season).toBe(2);
      expect(result.confidence).toBe(0.85);
      expect(result.heuristicUsed).toBe('H2-MultipleMatchesWithHint');
    });

    it('should return null if no episode count match', async () => {
      const result = await detector.correlateDiscToEpisodes({
        discNumber: null,
        extractedEpisodeCount: 999, // No season has this
        currentSeasonHint: null,
        seriesInfo
      });

      // Should fall through to H3
      expect(result.confidence).toBeLessThan(0.75);
    });
  });

  describe('Correlation Heuristic H3 - Fallback Logic', () => {
    const seriesInfo = {
      totalSeasons: 6,
      seasons: [
        { season: 1, episodeCount: 22 },
        { season: 2, episodeCount: 23 },
        { season: 6, episodeCount: 24 }
      ]
    };

    it('should use season hint from label', async () => {
      const result = await detector.correlateDiscToEpisodes({
        discNumber: null,
        extractedEpisodeCount: 20, // Doesn't match any season exactly
        currentSeasonHint: 1,
        seriesInfo
      });

      expect(result.season).toBe(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
      expect(result.heuristicUsed).toBe('H3-SeasonHintFromLabel');
    });

    it('should fallback to disc number as season', async () => {
      const result = await detector.correlateDiscToEpisodes({
        discNumber: 2,
        extractedEpisodeCount: 20,
        currentSeasonHint: null,
        seriesInfo
      });

      expect(result.season).toBe(2);
      expect(result.confidence).toBe(0.70);
      expect(result.heuristicUsed).toBe('H3-DiscNumberFallback');
    });

    it('should default to season 1 when all else fails', async () => {
      const result = await detector.correlateDiscToEpisodes({
        discNumber: null,
        extractedEpisodeCount: 20,
        currentSeasonHint: null,
        seriesInfo
      });

      expect(result.season).toBe(1);
      expect(result.confidence).toBe(0.65);
      expect(result.heuristicUsed).toBe('H3-DefaultToSeason1');
    });
  });

  describe('Confidence Scoring', () => {
    it('should have confidence 0.95 for perfect H1 match', async () => {
      const seriesInfo = {
        totalSeasons: 1,
        seasons: [{ season: 1, episodeCount: 22 }]
      };

      const result = await detector.correlateDiscToEpisodes({
        discNumber: 1,
        extractedEpisodeCount: 22,
        currentSeasonHint: null,
        seriesInfo
      });

      expect(result.confidence).toBe(0.95);
    });

    it('should have confidence 0.90 for unique H2 match', async () => {
      const seriesInfo = {
        totalSeasons: 3,
        seasons: [
          { season: 1, episodeCount: 22 },
          { season: 2, episodeCount: 24 }, // Unique
          { season: 3, episodeCount: 20 }
        ]
      };

      const result = await detector.correlateDiscToEpisodes({
        discNumber: null,
        extractedEpisodeCount: 24,
        currentSeasonHint: null,
        seriesInfo
      });

      expect(result.confidence).toBe(0.90);
    });

    it('should have confidence 0.65-0.80 for H3 fallback', async () => {
      const seriesInfo = {
        totalSeasons: 2,
        seasons: [
          { season: 1, episodeCount: 22 },
          { season: 2, episodeCount: 23 }
        ]
      };

      const result = await detector.correlateDiscToEpisodes({
        discNumber: null,
        extractedEpisodeCount: 999,
        currentSeasonHint: null,
        seriesInfo
      });

      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
      expect(result.confidence).toBeLessThanOrEqual(0.80);
    });
  });

  describe('Full Integration - One Tree Hill Example', () => {
    beforeEach(() => {
      mockTMDB.getTVDetails.mockResolvedValue({
        name: 'One Tree Hill',
        seasons: [
          { season_number: 0, episode_count: 5 },
          { season_number: 1, episode_count: 22, name: 'Season 1' },
          { season_number: 2, episode_count: 23, name: 'Season 2' },
          { season_number: 3, episode_count: 22, name: 'Season 3' },
          { season_number: 4, episode_count: 21, name: 'Season 4' },
          { season_number: 5, episode_count: 18, name: 'Season 5' },
          { season_number: 6, episode_count: 24, name: 'Season 6' }
        ]
      });
    });

    it('should correctly identify OTH_S1D1 (disc 1, season 1, 22 episodes)', async () => {
      parseBlurayStructure.mockResolvedValue({
        titles: Array(22).fill(null).map((_, i) => ({
          index: i,
          duration: 2640
        }))
      });

      const result = await detector.detectEpisodeNumbers({
        discPath: '/backups/OTH_S1D1',
        discType: 'bluray',
        volumeLabel: 'OTH_S1D1',
        tmdbId: 2108
      });

      expect(result.success).toBe(true);
      expect(result.season).toBe(1);
      expect(result.startEpisode).toBe(1);
      expect(result.endEpisode).toBe(22);
      expect(result.episodeCount).toBe(22);
      expect(result.confidence).toBe(0.95); // Perfect H1 match
      expect(result.heuristicUsed).toBe('H1-DiscEqualsSeasonWithMatch');
    });

    it('should correctly identify OTH_S1D6 (disc 6, season 6, 24 episodes)', async () => {
      parseBlurayStructure.mockResolvedValue({
        titles: Array(24).fill(null).map((_, i) => ({
          index: i,
          duration: 2640
        }))
      });

      const result = await detector.detectEpisodeNumbers({
        discPath: '/backups/OTH_S1D6',
        discType: 'bluray',
        volumeLabel: 'OTH_S1D6',
        tmdbId: 2108
      });

      expect(result.success).toBe(true);
      expect(result.season).toBe(6);
      expect(result.episodeCount).toBe(24);
      expect(result.confidence).toBe(0.95);
    });

    it('should handle label mismatch (S1D6 but actually Season 6)', async () => {
      parseBlurayStructure.mockResolvedValue({
        titles: Array(24).fill(null).map((_, i) => ({
          index: i,
          duration: 2640
        }))
      });

      // Label says S1D6 but has 24 episodes (only S6 has 24)
      const result = await detector.detectEpisodeNumbers({
        discPath: '/backups/OTH_S1D6',
        discType: 'bluray',
        volumeLabel: 'OTH_S1D6',
        tmdbId: 2108
      });

      // H1 fails (disc 6 ≠ season 1), H2 succeeds (24 episodes unique to S6)
      expect(result.season).toBe(6);
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing TMDB data', async () => {
      const result = await detector.correlateDiscToEpisodes({
        discNumber: 1,
        extractedEpisodeCount: 22,
        currentSeasonHint: 1,
        seriesInfo: null
      });

      expect(result.season).toBe(1);
      expect(result.episodeCount).toBe(22);
      expect(result.confidence).toBe(0.65);
      expect(result.correlationReason).toContain('No TMDB data available');
    });

    it('should handle disc parse failure', async () => {
      parseBlurayStructure.mockRejectedValue(new Error('Disc corrupt'));

      // Mock TMDB to avoid further errors
      mockTMDB.getTVDetails.mockResolvedValue({
        name: 'Test Show',
        seasons: [{ season_number: 1, episode_count: 22 }]
      });

      const result = await detector.detectEpisodeNumbers({
        discPath: '/bad/disc',
        discType: 'bluray',
        volumeLabel: 'SHOW_S1D1',
        tmdbId: 123
      });

      // detectEpisodeNumbers wraps errors and returns success:true with fallback values
      expect(result.success).toBe(true);
      expect(result.discStructure.episodeCount).toBe(0);
      expect(result.season).toBe(1); // Fallback to season hint
    });

    it('should handle malformed volume labels', async () => {
      const result = detector._parseVolumeLabel('ABCDEFG_RANDOM_LABEL_123');
      expect(result).toEqual({ seasonNumber: null, discNumber: null });
    });

    it('should handle zero episodes detected', async () => {
      parseBlurayStructure.mockResolvedValue({
        titles: [
          { index: 0, duration: 300 }  // Too short
        ]
      });

      mockTMDB.getTVDetails.mockResolvedValue({
        name: 'Test Show',
        seasons: [{ season_number: 1, episode_count: 22 }]
      });

      const result = await detector.detectEpisodeNumbers({
        discPath: '/disc',
        discType: 'bluray',
        volumeLabel: 'SHOW_S1D1',
        tmdbId: 123
      });

      expect(result.discStructure.episodeCount).toBe(0);
      // Should still correlate based on label hints
      expect(result.season).toBeGreaterThan(0);
    });
  });
});
