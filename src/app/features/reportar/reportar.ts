import { Component, AfterViewInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { IncidenciaService } from '../../core/incidencia.service';
import { Router, RouterLink } from '@angular/router';
import * as L from 'leaflet';
import { Subject, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, map, catchError } from 'rxjs/operators';
import { ZULIA_BOUNDS, ZULIA_CENTER, dentroDeZulia } from '../../core/zulia';
import { PuntosReferencia, PuntoRef } from '../../core/puntos-referencia';

@Component({
  selector: 'app-reportar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reportar.html',
  styleUrl: './reportar.css'
})
export class ReportarComponent implements AfterViewInit {
  private incService = inject(IncidenciaService);
  private router = inject(Router);
  private http = inject(HttpClient);

  titulo = '';
  descripcion = '';
  direccion = '';
  categoria = 'vialidad';
  isLoading = signal(false);
  sesionLista = signal(false);
  haySesion = computed(() => !!this.incService.usuarioId());

  private map!: L.Map;
  private marker!: L.Marker;
  lat = ZULIA_CENTER[0];
  lng = ZULIA_CENTER[1];

  fotosSeleccionadas: File[] = [];
  previewUrl = signal<string | ArrayBuffer | null>(null);

  sugerencias = signal<any[]>([]);
  private busquedaSubject = new Subject<string>();

  constructor() {
    this.incService.cargarSesion().then(() => this.sesionLista.set(true));
    this.busquedaSubject.pipe(
      debounceTime(350),
      map(t => t.trim()),
      distinctUntilChanged(),
      switchMap(termino => {
        if (termino.length < 3) return of(null);
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(termino)}&limit=8&lat=10.65&lon=-71.63&bbox=-73.4,8.2,-70.6,11.9`;
        return this.http.get<any>(url).pipe(catchError(() => of(null)));
      })
    ).subscribe((resp: any) => {
      const items = (resp?.features ?? [])
        .map((f: any) => {
          const p = f.properties;
          const calle = [p.street, p.housenumber].filter(Boolean).join(' ');
          const partes = [p.name, calle, p.district, p.city ?? p.county, p.state].filter(Boolean);
          return {
            display_name: [...new Set(partes)].join(', '),
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0]
          };
        })
        .filter((s: any) => dentroDeZulia(s.lat, s.lon));
      this.sugerencias.set(items);
    });
  }

  ngAfterViewInit() {
    this.map = L.map('mini-map', {
      minZoom: 8,
      maxBounds: ZULIA_BOUNDS,
      maxBoundsViscosity: 1.0
    }).setView([this.lat, this.lng], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    this.marker = L.marker([this.lat, this.lng], { draggable: true, zIndexOffset: 1000 }).addTo(this.map);

    // Puntos de referencia: al hacer clic en uno, el pin se mueve hasta allí
    new PuntosReferencia(this.map, p => this.seleccionarReferencia(p));

    this.marker.on('dragend', () => {
      const p = this.marker.getLatLng();
      if (!dentroDeZulia(p.lat, p.lng)) {
        this.marker.setLatLng([this.lat, this.lng]); // vuelve a la posición anterior
        alert('Solo se permiten reportes dentro del estado Zulia.');
        return;
      }
      this.lat = p.lat;
      this.lng = p.lng;
    });

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (!dentroDeZulia(e.latlng.lat, e.latlng.lng)) {
        alert('Solo se permiten reportes dentro del estado Zulia.');
        return;
      }
      this.marker.setLatLng(e.latlng);
      this.lat = e.latlng.lat;
      this.lng = e.latlng.lng;
    });
  }

  private seleccionarReferencia(p: PuntoRef) {
    if (!dentroDeZulia(p.lat, p.lng)) return;
    this.lat = p.lat;
    this.lng = p.lng;
    this.direccion = `Cerca de ${p.nombre}`;
    this.marker.setLatLng([p.lat, p.lng]);
    this.map.panTo([p.lat, p.lng]);
  }

  onDireccionChange(valor: string) {
    this.direccion = valor;
    this.busquedaSubject.next(valor);
  }

  seleccionarDireccion(sugerencia: any) {
    const lat = parseFloat(sugerencia.lat);
    const lng = parseFloat(sugerencia.lon);
    if (!dentroDeZulia(lat, lng)) return;

    this.direccion = sugerencia.display_name;
    this.lat = lat;
    this.lng = lng;

    if (this.map && this.marker) {
      this.map.setView([this.lat, this.lng], 16);
      this.marker.setLatLng([this.lat, this.lng]);
    }
    this.sugerencias.set([]);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const validos = Array.from(input.files ?? []).filter(f => {
      const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) && f.size <= 5 * 1024 * 1024;
      if (!ok) alert(`"${f.name}" no es válida (solo PNG/JPG/WEBP de hasta 5 MB).`);
      return ok;
    }).slice(0, 4);

    this.fotosSeleccionadas = validos;

    if (validos.length) {
      const reader = new FileReader();
      reader.onload = e => this.previewUrl.set(e.target?.result ?? null);
      reader.readAsDataURL(validos[0]);
    } else {
      this.previewUrl.set(null);
    }
  }

  async guardarReporte() {
    if (!this.haySesion()) {
      alert('Para enviar un reporte necesitas iniciar sesión.');
      return;
    }
    if (!this.titulo.trim()) {
      alert('Por favor, escribe un título para la incidencia.');
      return;
    }
    if (!dentroDeZulia(this.lat, this.lng)) {
      alert('La ubicación debe estar dentro del estado Zulia.');
      return;
    }

    this.isLoading.set(true);

    try {
      const fallidas = await this.incService.addIncidencia({
        title: this.titulo.trim(),
        descr: this.descripcion,
        cat: this.categoria,
        par: this.direccion || 'Ubicación seleccionada en mapa',
        lat: this.lat,
        lng: this.lng
      }, this.fotosSeleccionadas);

      alert(fallidas
        ? `Reporte enviado, pero ${fallidas} foto(s) no se pudieron subir.`
        : '¡Reporte enviado con éxito!');
      this.router.navigate(['/mapa']);
    } catch (error: any) {
      console.error('Error al guardar:', error);
      alert(error?.message ?? 'Hubo un error al guardar el reporte.');
    } finally {
      this.isLoading.set(false);
    }
  }
}