import { ConfigService } from '../config/config.service';
import { CryptoService, hashPassword, verifyPassword } from './crypto.service';
describe('secret handling', () => {
  const service = new CryptoService(new ConfigService());
  it('hashes passwords with per-password salt', async () => {
    const hash = await hashPassword('strong-password');
    expect(await verifyPassword('strong-password', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
    expect(hash).not.toBe(await hashPassword('strong-password'));
  });
  it('binds PIN to the delivery and authenticates encrypted payloads', () => {
    const pin = service.pin();
    const hash = service.hash(`delivery1:${pin}`);
    expect(pin).toMatch(/^\d{4}$/);
    expect(service.matches(`delivery1:${pin}`, hash)).toBe(true);
    expect(service.matches(`delivery2:${pin}`, hash)).toBe(false);
    const cipher = service.encrypt({ pin });
    expect(service.decrypt(cipher)).toEqual({ pin });
    expect(() => service.decrypt(cipher.replace(/^./, cipher[0] === 'a' ? 'b' : 'a'))).toThrow();
  });
});
