import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { UsuarioToken } from '../common/tipos';
import { tokenAUsuario } from '../common/guards';
import { RevocacionService } from '../common/revocacion';
import { config } from '../config';

/**
 * Canal en tiempo real para la pantalla de cocina (KDS) y los meseros.
 * El cliente se conecta a /cocina con { auth: { token: accessToken } }
 * y queda en la sala de su sede.
 *
 * Eventos que emite el servidor:
 *  - comanda.nueva   { pedidoId, numero, mesa, items[] }
 *  - item.estado     { itemId, pedidoId, estado, producto, cantidad, numero, mesa }
 *  - item.anulado    { itemId, pedidoId, producto, motivo }
 */
@WebSocketGateway({ namespace: '/cocina', cors: { origin: config.corsOrigins } })
export class CocinaGateway implements OnGatewayConnection {
  private readonly log = new Logger(CocinaGateway.name);

  @WebSocketServer()
  server: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly revocacion: RevocacionService,
  ) {
    // Al cerrar una sesión o revocar a un usuario, se cortan sus conexiones abiertas
    revocacion.alRevocar((r) => {
      for (const s of this.server?.sockets.values() ?? []) {
        const u = s.data.usuario as UsuarioToken | undefined;
        if (u && (r.tipo === 'usuario' ? u.id === r.id : u.sesionId === r.id)) s.disconnect(true);
      }
    });
  }

  handleConnection(cliente: Socket) {
    try {
      const payload = this.jwt.verify(String(cliente.handshake.auth?.token ?? ''));
      if (this.revocacion.estaRevocado(payload.sub, payload.sid, payload.iat)) throw new Error('revocado');
      const usuario = tokenAUsuario(payload);
      cliente.data.usuario = usuario;
      cliente.join(`sede:${usuario.sedeId}`);
      // El token se revisa solo al conectar: al vencer, se corta la conexión y el
      // cliente vuelve a entrar con uno renovado
      const vence = setTimeout(() => cliente.disconnect(true), Math.max(0, payload.exp * 1000 - Date.now()));
      cliente.once('disconnect', () => clearTimeout(vence));
    } catch {
      cliente.emit('error', 'No autorizado');
      cliente.disconnect(true);
    }
  }

  emitir(sedeId: string, evento: string, datos: unknown) {
    this.server?.to(`sede:${sedeId}`).emit(evento, datos);
    this.log.debug(`${evento} → sede ${sedeId}`);
  }
}
