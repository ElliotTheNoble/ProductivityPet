import type { shopEn } from './shop.en';

// Spanish strings for the Shop (same keys as shop.en.ts).
export const shopEs: Record<keyof typeof shopEn, string> = {
  shopCatAccessories: 'Accesorios',
  shopCatToys: 'Juguetes',
  shopCatCare: 'Cuidado',
  shopCatBackgrounds: 'Fondos',

  shopRestDeceased:
    'Tu gatito descansa en el recuerdo, así que las compras están en pausa. Para traerlo de vuelta, usa Resucitar en la sección en memoria de la pestaña Estadísticas ({cost} fichas de patita).',
  shopRestUnwell:
    '¡Tu gatito necesita descansar! Los accesorios volverán cuando se sienta mejor. Aún puedes comprar y usar juguetes y suministros de cuidado (mira esas pestañas).',
  shopKittyPreview: '🐾 Vista del gatito',

  shopOwned: '✓ Lo tienes',
  shopEquipped: '✓ Puesto',
  shopEquip: 'Ponerse',
  shopNotEnough: '¡No tienes suficientes fichas de patita!',
  shopBuying: 'Comprando…',
  shopBuy: 'Comprar',
  shopTestEquipped: '🧪 Puesto (prueba)',
  shopTestEquip: '🧪 Probar',

  careTitle: 'Suministros de cuidado',
  careWashclothDesc:
    'Se gasta con cada limpieza suave completada en el Baño: +25 de Limpieza para una mascota enferma o grave.',
  careMedicineDesc:
    'Da a una mascota enferma o grave +{boost} de Hambre y +{boost} de Felicidad. No cura por sí sola: se recupera cuando el hambre, la limpieza y la felicidad están todas en 50 o más.',
  careBoughtWashcloth: '¡Compraste una toallita suave!',
  careBoughtMedicine: '¡Compraste medicina para mascotas!',
  careGivenMedicine: 'Medicina dada. Se siente un poquito mejor.',
  careNotEnough: 'Aún no tienes suficientes fichas de patita. ¡Completa tus tareas para ganar más!',
  carePaused: 'Los suministros están en pausa mientras tu mascota descansa en el recuerdo.',
  careNoneLeft: 'No te quedan.',
  careNotNeeded: 'La medicina es solo para una mascota enferma o grave que ya nació.',
  careFailed: 'No funcionó. Inténtalo de nuevo.',
  careOwnLabel: 'Tienes {n}',
  careOwn: 'Tienes: {n}',
  careBuyLabel: 'Comprar {name} por {price} fichas de patita',
  careNeedMore: 'Te faltan {n} fichas de patita: ¡completa tus tareas para ganarlas!',
  careGiveLabel: 'Dar medicina a la mascota elegida',
  careGiveTo: 'Dar a {name}',
  careGiveToHer: 'ella',
  careResting:
    'No se pueden comprar ni usar suministros mientras tu mascota descansa en el recuerdo. Resucítala desde la tarjeta en memoria de Inicio para volver a cuidarla.',

  toyBought: '¡Compraste {name}!',
  toyPlaying: '¡{name} está jugando en la sala! +{happy} de Felicidad.',
  toyNotEnough: 'Aún no tienes suficientes fichas de patita. ¡Completa tus tareas para ganar más!',
  toyPaused: 'Los juguetes están en pausa mientras tu mascota descansa en el recuerdo.',
  toyEgg: 'Los juguetes son para una mascota que ya nació.',
  toyNoneLeft: 'No te quedan.',
  toyBusy: 'Ya hay un juguete en juego. Inténtalo en un momento.',
  toyFailed: 'No funcionó. Inténtalo de nuevo.',
  toyIntro: '¡Juega con los juguetes para hacer feliz a tu gatito! Los juguetes se gastan después de jugar.',
  toyHappiness: '+{happy} de Felicidad',
  toyBuyLabel: 'Comprar {name} por {price} fichas de patita',
  toyPlayLabel: 'Jugar con {name}',
  toyPlay: 'Jugar',
  toyRestingNote: 'No se pueden comprar ni usar juguetes mientras tu mascota descansa en el recuerdo.',
  toyEggNote: 'Los juguetes son para una mascota que ya nació. Aun así, puedes comprarlos ahora.',
  toyYouOwn: 'Tienes: {n}',
};
