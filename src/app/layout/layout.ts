import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { IncidenciaService } from '../core/incidencia.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, FormsModule],
  templateUrl: './layout.html',
  styleUrl: './layout.css'
})
export class LayoutComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private incService = inject(IncidenciaService);

  searchTerm = signal('');
  private userSignal = signal<string>('Invitado');
  userName = computed(() => this.userSignal());
  esOperador = computed(() => ['operador', 'admin'].includes(this.incService.rol()));
  haySesion = computed(() => !!this.incService.usuarioId());

  ngOnInit() {
    this.incService.cargarSesion();
    this.authService.getUser().then(user => {
      if (!user) return;
      const meta = user.user_metadata ?? {};
      const nombreCompleto = [meta['nombre'], meta['apellido']]
        .filter(Boolean)
        .join(' ')
        .trim();
      // Si el usuario aún no tiene nombre guardado, se muestra el correo
      this.userSignal.set(nombreCompleto || user.email || 'Invitado');
    });
  }

  // Al escribir en la barra, actualizamos el Signal global del servicio
  onSearchChange(value: string) {
    this.searchTerm.set(value);
    this.incService.setSearchTerm(value);
  }

  async logout() {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }
}