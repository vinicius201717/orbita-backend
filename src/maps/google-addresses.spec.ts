import { ConfigService } from '../config/config.service';
import { GoogleMapsProvider } from './google-maps.provider';

describe('address candidates', () => {
  const provider = new GoogleMapsProvider({ get: () => 'test-key' } as unknown as ConfigService);
  afterEach(() => jest.restoreAllMocks());
  it('returns candidate coordinates and flags approximate matches for user confirmation', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
          results: [
            {
              formatted_address: 'Rua A, 10',
              geometry: { location: { lat: -16.68, lng: -49.25 }, location_type: 'ROOFTOP' },
            },
            {
              formatted_address: 'Rua A',
              partial_match: true,
              geometry: { location: { lat: -16.69, lng: -49.26 }, location_type: 'GEOMETRIC_CENTER' },
            },
          ],
        }),
      ),
    );
    expect(await provider.searchAddresses('Rua A, 10, Goiânia')).toEqual([
      { address: 'Rua A, 10', latitude: -16.68, longitude: -49.25, approximate: false },
      { address: 'Rua A', latitude: -16.69, longitude: -49.26, approximate: true },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('language=pt-BR');
  });
  it('distinguishes no results from provider errors and rejects invalid coordinates', async () => {
    const mocked = jest.spyOn(global, 'fetch');
    mocked.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ZERO_RESULTS', results: [] })));
    expect(await provider.searchAddresses('Nada')).toEqual([]);
    mocked.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'REQUEST_DENIED' })));
    await expect(provider.searchAddresses('Rua A')).rejects.toThrow();
    mocked.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'OK',
          results: [
            {
              formatted_address: 'Bad',
              geometry: { location: { lat: 999, lng: 0 }, location_type: 'ROOFTOP' },
            },
          ],
        }),
      ),
    );
    await expect(provider.searchAddresses('Rua A')).rejects.toThrow();
  });
});
