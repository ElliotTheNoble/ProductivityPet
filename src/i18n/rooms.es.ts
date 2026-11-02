import type { roomsEn } from './rooms.en';

// Spanish strings for the Rooms hub, the room pages and the bathing tools.
export const roomsEs: Record<keyof typeof roomsEn, string> = {
  hubHeading: '🏠 Explora tu hogar',
  hubSubheading: 'Cada cuarto te ayuda a concentrarte en una parte distinta de tu vida. ¡Toca un cuarto para entrar!',
  hubEnterRoom: 'Entrar al cuarto →',
  hubEnterLabel: 'Entrar a {room}',
  hubNoTasks: 'No hay tareas para hoy',
  hubTasks_one: '{count} tarea para hoy',
  hubTasks_other: '{count} tareas para hoy',

  roomDescStudy: 'Donde las mentes concentradas (y los bigotes) hacen las cosas. 📚',
  roomDescGym: '¡Es hora de estirar esas patitas y ponerse en movimiento! 💪',
  roomDescBedroom: 'Dulces sueños y noches estrelladas te esperan. 🌙',
  roomDescBathroom: 'Burbujas, hora del baño y pelaje limpiecito. 🛁',
  roomDescKitchen: 'Preparando algo delicioso juntos. 🍳',

  backToRooms: '← Volver a los cuartos',

  roomTasksLiving: 'Tareas de la sala de estar',
  roomTasksStudy: 'Tareas del cuarto de estudio',
  roomTasksGym: 'Tareas del gimnasio',
  roomTasksBedroom: 'Tareas del dormitorio',
  roomTasksBathroom: 'Tareas del baño',
  roomTasksKitchen: 'Tareas de la cocina',
  panelEmpty: '¡Aún no hay tareas! ¡Agreguemos una! 🐾',
  panelAllDone: '¡Yupi! ¡Todo listo! 🎉',
  panelPlaceholder: '¿Qué hay que hacer aquí?',
  panelAdd: '+ Agregar una tarea a este cuarto',
  panelCollapse: '▾ Contraer',

  bathSoapHint: '🧼 ¡Pasa el cursor sobre el círculo brillante para enjabonar a tu gatito!',
  bathRinseHint: '🚿 ¡Pasa el cursor sobre el círculo brillante para enjuagar a tu gatito!',
  bathDryHint: '💨 ¡Pasa el cursor sobre el círculo brillante para secar a tu gatito!',
  bathSoapName: 'Jabón básico',
  bathHose: 'Manguera de ducha',
  bathDryer: 'Secador',

  wipeDone: '¡Todo fresquito! ✨',
  wipeAgain: 'Limpiar otra vez',
  wipeNotNeeded: 'Tu gatito no necesita un baño suave ahora.',
  wipeNeedsWashcloth: 'Tu gatito necesita una toallita suave.',
  wipeBuyHint: 'Consigue una en la tienda por {price} fichas de patita.',
  wipeNotEnough: '¡No tienes suficientes fichas de patita! Completa tareas para ganar más.',
  wipeGoShop: 'Ir a la tienda',
  wipeDragHint: 'Está muy mal para bañarse — pasa suavemente la toallita por su pelaje para refrescarlo',
  wipeCleanliness: ' (Limpieza {n}%)',
};
