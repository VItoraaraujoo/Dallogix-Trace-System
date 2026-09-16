FROM php:8.3-fpm-alpine@sha256:ab8d86895157617b398008797fab928db029dd05000996916d2e1526d22ce83b

RUN docker-php-ext-install pdo_mysql \
    && { \
        echo 'expose_php=Off'; \
        echo 'display_errors=Off'; \
        echo 'log_errors=On'; \
        echo 'allow_url_fopen=Off'; \
        echo 'opcache.enable=1'; \
        echo 'opcache.enable_cli=0'; \
        echo 'opcache.memory_consumption=128'; \
        echo 'opcache.max_accelerated_files=10000'; \
        echo 'opcache.validate_timestamps=1'; \
        echo 'opcache.revalidate_freq=2'; \
    } > "$PHP_INI_DIR/conf.d/zz-security.ini"
WORKDIR /var/www/servidor
USER www-data
