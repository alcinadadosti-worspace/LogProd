const PHOTOS = {
  'Alberto':        '/perfis/Alberto.jpg',
  'Claudio':        '/perfis/Claudio.jpg',
  'Danrley':        '/perfis/Danrley.jpg',
  'Felipe Guedes':  '/perfis/Felipe Guedes.jpg',
  'Hugo Castro':    '/perfis/Hugo.png',
  'João Victor':    '/perfis/João Victor.jpg',
  'Luciano Torres': '/perfis/Luciano Torres.jpg',
  'Paulo Cesar':    '/perfis/Paulo Cesar.jpg',
  'Pedro Lucas':    '/perfis/Pedro Lucas.jpg',
  'Robéria Gilo':   '/perfis/Robéria Gilo.png',
  'Thalys Gomes':   '/perfis/Thalys Gomes.jpg',
  'Yuri Castro':    '/perfis/Yuri Castro.jpg',
};

export function stockistPhoto(name) {
  return PHOTOS[name] ?? null;
}
