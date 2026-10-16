import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { tokenAUsuario } from '../common/guards';
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

  constructor(private readonly jwt: JwtService) {}

  handleConnection(cliente: Socket) {
    try {
      const usuario = tokenAUsuario(this.jwt.verify(String(cliente.handshake.auth?.token ?? '')));
      cliente.data.usuario = usuario;
      cliente.join(`sede:${usuario.sedeId}`);
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
