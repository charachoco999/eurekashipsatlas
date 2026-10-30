# Atlas de progresión online · Minecraft 1.20.1 Forge

Versión web comunitaria del Atlas. Conserva la progresión y los desafíos, sincroniza los avances en Supabase y añade cuentas, panel de administración y revisión privada de capturas.

## Qué incluye

- Inicio de sesión y registro mediante nombre de usuario y contraseña (sin pedir correos reales).
- Sincronización de árboles y desafíos entre dispositivos.
- Panel de administración para consultar el progreso de cada perfil.
- Restablecimiento de contraseña de un jugador por parte del administrador. **Nunca se pueden leer las contraseñas actuales.**
- Envío privado de capturas de desafíos y aprobación/rechazo desde administración.
- La contraseña se gestiona con Supabase Auth; no se guarda en texto plano en las tablas del Atlas.
- El progreso sigue teniendo exportación/importación JSON como copia local.

> Esta edición no incluye páginas de progresión centradas en mods de armas. El resto de árboles y los 90 desafíos se mantienen.

## 1. Crear el proyecto Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor → New query**.
3. Copia todo `supabase/schema.sql`, ejecútalo y comprueba que termina sin errores.
4. Ve a **Authentication → Providers → Email** y desactiva **Confirm email**. La web no solicita correos reales y usa identificadores internos terminados en `.invalid`, por lo que no habría un buzón al que enviar confirmaciones.
5. Deja activado **Allow new users to sign up** mientras tú y tus amigos creáis las cuentas.

### Por qué aparece un email interno

Supabase Auth admite contraseña asociada a email o teléfono, no un nombre de usuario puro. Para mantener la pantalla sencilla, el jugador solo escribe su username; el navegador lo traduce internamente a `username@atlas.invalid`. `.invalid` es un dominio reservado que no corresponde a una dirección de correo real. No se envían mensajes ni se pide una dirección personal.

## 2. Crear tu cuenta de administrador

1. En la web, crea la primera cuenta con el nombre de usuario `admin` y una contraseña nueva, exclusiva para este Atlas.
2. **No reutilices la contraseña que compartiste en el chat.** Ya no es privada. Elige otra que no uses en ningún otro servicio.
3. En Supabase, abre **SQL Editor** y ejecuta:

```sql
UPDATE auth.users
SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
WHERE email = 'admin@atlas.invalid';
```

4. Cierra sesión e inicia sesión otra vez. El rol administrativo se guarda en `app_metadata`, que un usuario normal no puede cambiar desde el navegador.

Para añadir otro administrador, crea su usuario normalmente y cambia el email interno de la consulta a `su_usuario@atlas.invalid`.

## 3. Configurar el frontend

Abre `config.js` y sustituye los dos valores:

```js
window.ATLAS_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU_PUBLISHABLE_O_ANON_KEY"
};
```

Puedes encontrar la URL y la **publishable key** (o la antigua `anon` key) en **Project Settings → API Keys**.

La publishable/anon key está diseñada para ser pública en webs estáticas. La seguridad depende de RLS y de las políticas SQL. **Nunca pongas `service_role`, `secret key` ni una contraseña de administrador en `config.js`, HTML o JavaScript.**

## 4. Desplegar la función administrativa

La función `admin-tools` realiza las acciones que no deben exponerse al navegador: listar todos los perfiles, restablecer contraseñas y revisar evidencias. Usa la clave secreta del proyecto solo en el servidor de Supabase.

Con [Supabase CLI](https://supabase.com/docs/guides/cli) instalado:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy admin-tools
```

Supabase inyecta las claves de servidor en el entorno de Edge Functions. No copies la clave secreta a los archivos de la web. La función valida el JWT y exige `app_metadata.role = admin` antes de cada operación.

## 5. Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `modpack-atlas`.
2. Sube el contenido de esta carpeta, incluido `config.js` ya configurado.
3. En el repositorio, abre **Settings → Pages**.
4. En **Build and deployment**, selecciona **Deploy from a branch**, la rama `main` y la carpeta `/ (root)`.
5. Guarda y espera a que GitHub Pages publique la dirección.

GitHub Pages solo sirve los archivos estáticos. La autenticación, el progreso y las evidencias viven en Supabase.

## 6. Registrar a los amigos y cerrar el registro

1. Comparte la dirección de la web con tus amigos.
2. Cada uno crea su cuenta con un username distinto y una contraseña nueva que no utilice en otros sitios.
3. Cuando estén creadas las cuatro cuentas, puedes desactivar **Allow new users to sign up** en Supabase Auth. Los jugadores existentes podrán seguir iniciando sesión.
4. Si alguien olvida su contraseña, entra el administrador, abre Administración y pulsa **Restablecer contraseña**. Escribe una nueva contraseña temporal y entrégasela al jugador por privado. El usuario puede cambiarla desde el botón **Contraseña**.

## 7. Capturas y recompensas

Cuando un jugador complete un desafío, el popup permite adjuntar PNG, JPG o WEBP de hasta 8 MB. Los archivos se guardan en el bucket privado `atlas-evidence`; no son públicos ni tienen una URL permanente. El administrador puede abrir un enlace firmado de cinco minutos y marcar la evidencia como verificada o rechazada.

## 8. Seguridad y límites

- No se almacenan contraseñas legibles ni se añade un botón para verlas. Supabase Auth verifica las contraseñas sin que el administrador pueda recuperarlas.
- El administrador puede establecer una contraseña nueva; la existente no se revela.
- Un usuario solo puede leer y editar su propio progreso. El administrador puede consultar todos los perfiles mediante una Edge Function protegida.
- Las capturas son privadas y solo el propietario o el administrador puede verlas.
- El progreso del Atlas es autodeclarado por el jugador. La web no inspecciona el mundo de Minecraft ni puede demostrar por sí sola que un nodo se haya completado.
- El sello de la carta es una marca visual y no una firma criptográfica. La evidencia ayuda a revisar logros, pero una captura también puede editarse.
- Haz exportaciones JSON de vez en cuando y conserva una copia del SQL y del repositorio.

## Estructura

```text
modpack-atlas-online/
├── index.html
├── config.js
├── config.example.js
├── js/cloud.js
└── supabase/
    ├── schema.sql
    ├── config.toml
    └── functions/admin-tools/index.ts
```
